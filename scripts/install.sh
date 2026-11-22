#!/usr/bin/env bash
# Install or update Hearth on this Mac. Safe to re-run; that's how you update.
#
#   curl -fsSL https://github.com/keshy/hearth/releases/latest/download/install.sh | bash
#       installs the latest release (no Go or checkout needed)
#   scripts/install.sh
#       from a checkout: builds appshome from source and deploys from its origin remote
#
# Everything machine-specific (Homebrew prefix, user, LAN IP, router) is
# detected here or at runtime. Optional overrides:
#   HEARTH_VERSION=v0.1.0           install this release instead of the latest
#   APPS_HOME_REPO_URL=git@...      repo the apps are deployed from
#   APPS_HOME_BRANCH=main           branch to deploy
#   APPS_HOME_DATA=/path            data directory
#   APPS_HOME_BACKUP_BUCKET=name    enable nightly backup to gs://name/apps-home
#   KEEP_AWAKE=1|0                  set (or skip) "never sleep" without asking
set -euo pipefail

GITHUB_REPO="keshy/hearth"
say() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "this installer is for macOS"
[[ $EUID -ne 0 ]] || die "run as your normal user; the script asks for sudo when it needs it"
command -v brew >/dev/null || die "install Homebrew first: https://brew.sh"

SRC=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

# Download a release bundle, verify it against the release's checksums, and
# print the folder it was extracted to.
fetch_release() {
  local arch name base tmp want got
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    x86_64) arch=amd64 ;;
    *) die "unsupported CPU $(uname -m)" ;;
  esac
  name="hearth-darwin-$arch"
  base="https://github.com/$GITHUB_REPO/releases/latest/download"
  [[ -n "${HEARTH_VERSION:-}" ]] && base="https://github.com/$GITHUB_REPO/releases/download/$HEARTH_VERSION"
  tmp="$(mktemp -d)"
  curl -fsSL "$base/$name.tar.gz" -o "$tmp/$name.tar.gz" || die "couldn't download $base/$name.tar.gz"
  curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt" || die "couldn't download $base/checksums.txt"
  want="$(awk -v f="$name.tar.gz" '$2 == f { print $1 }' "$tmp/checksums.txt")"
  got="$(shasum -a 256 "$tmp/$name.tar.gz" | awk '{ print $1 }')"
  [[ -n "$want" && "$want" == "$got" ]] || die "checksum mismatch for $name.tar.gz"
  tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
  echo "$tmp/$name"
}

# Piped from curl: fetch the bundle and run its installer with a real
# terminal for the password prompt.
if [[ -z "$SRC" || ! -f "$SRC/deploy/launchd/com.appshome.serve.plist" ]]; then
  say "Downloading Hearth ${HEARTH_VERSION:-(latest release)}"
  bundle="$(fetch_release)"
  if [[ -r /dev/tty ]]; then
    exec bash "$bundle/scripts/install.sh" </dev/tty
  fi
  exec bash "$bundle/scripts/install.sh"
fi

MODE=source
[[ -f "$SRC/VERSION" && -x "$SRC/bin/appshome" ]] && MODE=release

PREFIX="$(brew --prefix)"
RUN_USER="$(id -un)"
DATA="${APPS_HOME_DATA:-$PREFIX/var/apps-home}"
BIN="$PREFIX/bin/appshome"
SHARE="$PREFIX/share/hearth"

say "Installing dependencies with Homebrew"
deps=(caddy)
[[ $MODE == source ]] && deps+=(go)
for pkg in "${deps[@]}"; do
  command -v "$pkg" >/dev/null || brew install "$pkg"
done
git --version >/dev/null 2>&1 || brew install git
CADDY="$(command -v caddy)"

if [[ $MODE == release ]]; then
  VERSION="$(cat "$SRC/VERSION")"
  say "Installing appshome $VERSION"
  install -m 755 "$SRC/bin/appshome" "$BIN"
else
  say "Building appshome from $SRC"
  VERSION="$(git -C "$SRC" describe --tags --always --dirty 2>/dev/null || echo dev)"
  (cd "$SRC" && go build -trimpath -ldflags "-X main.version=$VERSION" -o "$BIN" ./cmd/appshome)
fi
echo "installed $BIN ($VERSION)"
mkdir -p "$SHARE"
install -m 755 "$SRC/scripts/uninstall.sh" "$SRC/scripts/backup-gcs.sh" "$SHARE/"

say "Preparing $DATA"
init_args=()
REMOTE="${APPS_HOME_REPO_URL:-}"
if [[ -z "$REMOTE" && $MODE == source ]]; then
  REMOTE="$(git -C "$SRC" remote get-url origin 2>/dev/null || true)"
  # No remote: serve straight from this checkout; `git pull` here deploys.
  [[ -z "$REMOTE" ]] && init_args+=(--repo-url "" --repo-dir "$SRC")
fi
if [[ -z "$REMOTE" && $MODE == release ]] && ! grep -qE '"repo_(url|dir)": *"[^"]' "$DATA/config.json" 2>/dev/null; then
  # First release install; later runs keep whatever repo the config points at.
  REMOTE="$(cat "$SRC/REPO_URL" 2>/dev/null || true)"
fi
if [[ -n "$REMOTE" ]]; then
  # The service keeps its own clone and deploys new commits on the branch.
  init_args+=(--repo-url "$REMOTE" --repo-dir "")
fi
[[ -n "${APPS_HOME_BRANCH:-}" ]] && init_args+=(--branch "$APPS_HOME_BRANCH")
if command -v gcloud >/dev/null && ! grep -q '"gcp_project": *"[^"]' "$DATA/config.json" 2>/dev/null; then
  # launchd's PATH has no gcloud, so record the project now.
  project="$(gcloud config get-value project 2>/dev/null || true)"
  [[ -n "$project" ]] && init_args+=(--gcp-project "$project")
fi
"$BIN" init --data "$DATA" ${init_args[@]+"${init_args[@]}"}
"$BIN" set-password --data "$DATA" --if-unset

repo_url="$(sed -n 's/.*"repo_url": *"\([^"]*\)".*/\1/p' "$DATA/config.json")"
if [[ -n "$repo_url" ]] && ! GIT_TERMINAL_PROMPT=0 git ls-remote "$repo_url" HEAD >/dev/null 2>&1; then
  echo "warning: can't reach $repo_url without a prompt. The service needs non-interactive"
  echo "         access (an SSH key without a passphrase in ~/.ssh/config, or a credential"
  echo "         helper) to pull apps and for the builder to push."
fi

say "Installing services (sudo)"
sudo -v
render() {
  sed -e "s|__BIN__|$BIN|g" -e "s|__DATA__|$DATA|g" -e "s|__USER__|$RUN_USER|g" \
      -e "s|__HOME__|$HOME|g" -e "s|__CADDY__|$CADDY|g" -e "s|__SHARE__|$SHARE|g" \
      -e "s|__BUCKET__|${APPS_HOME_BACKUP_BUCKET:-}|g" -e "s|__PATH__|$PREFIX/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin|g" \
      "$1"
}
install_daemon() {
  local label="$1" dest="/Library/LaunchDaemons/$1.plist" tmp
  tmp="$(mktemp)"
  render "$SRC/deploy/launchd/$label.plist" > "$tmp"
  plutil -lint "$tmp" >/dev/null
  sudo install -m 644 -o root -g wheel "$tmp" "$dest"
  rm -f "$tmp"
  sudo launchctl bootout "system/$label" 2>/dev/null || true
  sudo launchctl bootstrap system "$dest"
  echo "loaded $label"
}
install_daemon com.appshome.caddy
install_daemon com.appshome.serve
install_daemon com.appshome.dns
if [[ -n "${APPS_HOME_BACKUP_BUCKET:-}" ]]; then
  command -v gcloud >/dev/null || echo "warning: gcloud not found; backups will fail until it's installed (brew install --cask google-cloud-sdk)"
  install_daemon com.appshome.backup
fi

FW=/usr/libexec/ApplicationFirewall/socketfilterfw
if "$FW" --getglobalstate 2>/dev/null | grep -q enabled; then
  say "Allowing Caddy and appshome through the macOS firewall"
  for app in "$(realpath "$CADDY")" "$BIN"; do
    sudo "$FW" --add "$app" >/dev/null
    sudo "$FW" --unblockapp "$app" >/dev/null
  done
fi

keep_awake="${KEEP_AWAKE:-}"
if [[ -z "$keep_awake" && -t 0 ]]; then
  read -r -p $'\nKeep this Mac awake and restart it after power failures? [Y/n] ' ans
  [[ "$ans" =~ ^[Nn] ]] && keep_awake=0 || keep_awake=1
fi
if [[ "$keep_awake" == 1 ]]; then
  sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1
  echo "power settings: never sleep, restart after power failure, wake for network access"
fi

say "Checking everything"
sleep 3
"$BIN" doctor --data "$DATA" || true

if [[ $MODE == release ]]; then
  update="curl -fsSL https://github.com/$GITHUB_REPO/releases/latest/download/install.sh | bash"
else
  update="cd \"$SRC\" && git pull && scripts/install.sh"
fi
cat <<EOF

Logs:      $DATA/logs/
Apps:      push to the repo; the service deploys within a minute (appshome deploy to force)
Builder:   gcloud auth application-default login   (once, as $RUN_USER)
Update:    $update
Uninstall: $SHARE/uninstall.sh
EOF
