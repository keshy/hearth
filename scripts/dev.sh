#!/usr/bin/env bash
# Run the whole stack locally on unprivileged ports, with data in ./.dev-data.
# Nothing is installed system-wide. Ctrl-C stops everything.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$REPO/.dev-data"
BIN="$REPO/bin/appshome"
command -v caddy >/dev/null || { echo "caddy not found: brew install caddy"; exit 1; }

cd "$REPO"
go build -o "$BIN" ./cmd/appshome
"$BIN" init --data "$DATA" --http-port 8080 --https-port 8443 \
  --app-listen 127.0.0.1:7071 --caddy-admin localhost:2020 --dns-listen 127.0.0.1:15353 \
  --repo-url "" --repo-dir "$REPO" --poll 5 >/dev/null
echo "devpassword" | "$BIN" set-password --data "$DATA" --stdin --if-unset >/dev/null
mkdir -p "$DATA/logs"

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

XDG_CONFIG_HOME="$DATA/caddy-config" caddy run --config "$DATA/Caddyfile" --adapter caddyfile \
  >"$DATA/logs/caddy.log" 2>&1 & pids+=($!)
"$BIN" serve --data "$DATA" >"$DATA/logs/serve.log" 2>&1 & pids+=($!)
"$BIN" dns --data "$DATA" >"$DATA/logs/dns.log" 2>&1 & pids+=($!)

cat <<EOF
apps-home dev stack running (logs in .dev-data/logs/)
Serving apps/ from this checkout; edits go live within 5 seconds.
The App Builder commits what it builds into this checkout (apps/<name>).

  Portal:  curl -k --resolve apps.home:8443:127.0.0.1 https://apps.home:8443/
  Admin:   curl -k -u admin:devpassword --resolve admin.apps.home:8443:127.0.0.1 https://admin.apps.home:8443/
  DNS:     dig @127.0.0.1 -p 15353 anything.apps.home +short
  Doctor:  bin/appshome doctor --data .dev-data

  App:     curl -k --resolve groceries.apps.home:8443:127.0.0.1 https://groceries.apps.home:8443/

  In a browser, add to /etc/hosts:  127.0.0.1 apps.home admin.apps.home <name>.apps.home
  then open https://apps.home:8443 (admin password: devpassword)

Ctrl-C to stop.
EOF
wait
