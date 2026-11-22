#!/usr/bin/env bash
# Stop and remove the apps-home services. Apps, config and certificates in the
# data directory are left in place.
set -euo pipefail

for label in com.appshome.backup com.appshome.dns com.appshome.serve com.appshome.caddy; do
  if [[ -f "/Library/LaunchDaemons/$label.plist" ]]; then
    sudo launchctl bootout "system/$label" 2>/dev/null || true
    sudo rm -f "/Library/LaunchDaemons/$label.plist"
    echo "removed $label"
  fi
done

PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"
rm -f "$PREFIX/bin/appshome"
# This script may live in share/hearth; bash keeps reading its open file after deletion.
rm -rf "$PREFIX/share/hearth"
echo "Data kept at ${APPS_HOME_DATA:-$PREFIX/var/apps-home}. Delete it yourself if you want a clean slate."
