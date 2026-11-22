#!/usr/bin/env bash
# Build release bundles into dist/: one tarball per Mac CPU (appshome, the
# LaunchDaemons and scripts), the installer on its own for `curl | bash`,
# and checksums.txt. CI runs this on version tags.
# Usage: scripts/release.sh VERSION [REPO_URL]
set -euo pipefail

VERSION="${1:?usage: release.sh VERSION [REPO_URL]}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_URL="${2:-$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)}"
DIST="$ROOT/dist"
cd "$ROOT"

rm -rf "$DIST"
mkdir -p "$DIST/stage"
for arch in arm64 amd64; do
  name="hearth-darwin-$arch"
  stage="$DIST/stage/$name"
  mkdir -p "$stage/bin" "$stage/scripts" "$stage/deploy"
  CGO_ENABLED=0 GOOS=darwin GOARCH="$arch" go build -trimpath \
    -ldflags "-s -w -X main.version=$VERSION" -o "$stage/bin/appshome" ./cmd/appshome
  cp -R deploy/launchd "$stage/deploy/"
  cp scripts/install.sh scripts/uninstall.sh scripts/backup-gcs.sh "$stage/scripts/"
  cp LICENSE README.md "$stage/"
  echo "$VERSION" > "$stage/VERSION"
  echo "$REPO_URL" > "$stage/REPO_URL"
  tar -C "$DIST/stage" -czf "$DIST/$name.tar.gz" "$name"
done
rm -rf "$DIST/stage"
cp scripts/install.sh "$DIST/install.sh"
(cd "$DIST" && shasum -a 256 *.tar.gz install.sh > checksums.txt)
ls -l "$DIST"
