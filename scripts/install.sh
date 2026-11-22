#!/usr/bin/env bash
# Install or update apps-home on this Mac. Safe to re-run after `git pull`.
#
# Everything machine-specific (Homebrew prefix, user, LAN IP, router) is
# detected here or at runtime. Optional overrides:
#   APPS_HOME_DATA=/path            data directory
#   APPS_HOME_BACKUP_BUCKET=name    enable nightly backup to gs://name/apps-home
#   KEEP_AWAKE=1|0                  set (or skip) "never sleep" without asking
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
say() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "this installer is for macOS"
[[ $EUID -ne 0 ]] || die "run as your normal user; the script asks for sudo when it needs it"
command -v brew >/dev/null || die "install Homebrew first: https://brew.sh"

PREFIX="$(brew --prefix)"
RUN_USER="$(id -un)"
DATA="${APPS_HOME_DATA:-$PREFIX/var/apps-home}"
BIN="$PREFIX/bin/appshome"

say "Installing dependencies with Homebrew"
for pkg in go caddy; do
  command -v "$pkg" >/dev/null || brew install "$pkg"
done
CADDY="$(command -v caddy)"

say "Building appshome"
VERSION="$(git -C "$REPO" describe --always --dirty 2>/dev/null || echo dev)"
(cd "$REPO" && go build -trimpath -ldflags "-X main.version=$VERSION" -o "$BIN" ./cmd/appshome)
echo "built $BIN ($VERSION)"

say "Preparing $DATA"
init_args=()
REMOTE="${APPS_HOME_REPO_URL:-$(git -C "$REPO" remote get-url origin 2>/dev/null || true)}"
if [[ -n "$REMOTE" ]]; then
  # The service keeps its own clone and deploys new commits on the branch.
  init_args+=(--repo-url "$REMOTE" --repo-dir "")
  echo "deploying from $REMOTE (branch ${APPS_HOME_BRANCH:-main})"
  if ! GIT_TERMINAL_PROMPT=0 git ls-remote "$REMOTE" HEAD >/dev/null 2>&1; then
    echo "warning: can't reach $REMOTE without a prompt. The service needs non-interactive"
    echo "         access (an SSH key without a passphrase, or a credential helper) to pull and push."
  fi
else
  # No remote: serve straight from this checkout; `git pull` here deploys.
  init_args+=(--repo-url "" --repo-dir "$REPO")
  echo "no git remote; serving apps from $REPO"
fi
[[ -n "${APPS_HOME_BRANCH:-}" ]] && init_args+=(--branch "$APPS_HOME_BRANCH")
if command -v gcloud >/dev/null && ! grep -q '"gcp_project": *"[^"]' "$DATA/config.json" 2>/dev/null; then
  # launchd's PATH has no gcloud, so record the project now.
  project="$(gcloud config get-value project 2>/dev/null || true)"
  [[ -n "$project" ]] && init_args+=(--gcp-project "$project")
fi
"$BIN" init --data "$DATA" "${init_args[@]}"
"$BIN" set-password --data "$DATA" --if-unset

say "Installing services (sudo)"
sudo -v
render() {
  sed -e "s|__BIN__|$BIN|g" -e "s|__DATA__|$DATA|g" -e "s|__USER__|$RUN_USER|g" \
      -e "s|__HOME__|$HOME|g" -e "s|__CADDY__|$CADDY|g" -e "s|__REPO__|$REPO|g" \
      -e "s|__BUCKET__|${APPS_HOME_BACKUP_BUCKET:-}|g" -e "s|__PATH__|$PREFIX/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin|g" \
      "$1"
}
install_daemon() {
  local label="$1" dest="/Library/LaunchDaemons/$1.plist" tmp
  tmp="$(mktemp)"
  render "$REPO/deploy/launchd/$label.plist" > "$tmp"
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

cat <<EOF

Logs:      $DATA/logs/
Apps:      push to the repo; the service deploys within a minute (appshome deploy to force)
Builder:   gcloud auth application-default login   (once, as $RUN_USER)
Update:    cd "$REPO" && git pull && scripts/install.sh   (rebuilds the appshome binary)
Uninstall: scripts/uninstall.sh
EOF
