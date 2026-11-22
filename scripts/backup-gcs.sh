#!/usr/bin/env bash
# Mirror the apps-home data directory to gs://BUCKET/apps-home.
# Usage: scripts/backup-gcs.sh BUCKET   (needs `gcloud auth login` once)
set -euo pipefail

BUCKET="${1:?usage: backup-gcs.sh BUCKET}"
PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"
DATA="${APPS_HOME_DATA:-$PREFIX/var/apps-home}"

echo "$(date '+%F %T') backing up $DATA to gs://$BUCKET/apps-home"
gcloud storage rsync --recursive --delete-unmatched-destination-objects \
  --exclude='^logs/|^caddy/locks/|/\.tmp-|^apps/\.' \
  "$DATA" "gs://$BUCKET/apps-home"
echo "$(date '+%F %T') done"
