# apps-home

One front door for every app in the house. Each app lives in this repo under
`apps/<name>/`, and an always-on Mac deploys it to `https://<name>.apps.home`.
The portal at `https://apps.home` lists everything, and `https://admin.apps.home`
shows deploy status. One of the apps, the **App Builder**, turns a plain-English
description into a new app with Gemini and puts it live.

```
phone / laptop / TV
   │  DNS: router hands out the Mac as DNS server
   ▼
appshome dns ── *.apps.home → Mac's LAN IP, everything else → router / 1.1.1.1
   │
   ▼
Caddy :443 (HTTPS with its own local CA)
   ├── apps.home, admin.apps.home ─────► appshome serve (portal, admin, APIs)
   ├── <name>.apps.home (static) ──────► live/<name>/ files  (+ /_api/* → appshome)
   ├── <name>.apps.home (proxied) ─────► your own backend somewhere on the LAN
   └── <name>.apps.home (link) ────────► redirect to the URL
```

`appshome serve` checks the repo every minute. Each app folder is hashed;
changed apps are built (if they have a build step) into a new release and
swapped in atomically. If a build fails, the previous version keeps running.

## Adding an app

Make a folder under `apps/` with an `app.yaml` and push to `main`. The folder
name is the subdomain (lowercase letters, digits and dashes).

```yaml
title: Groceries                 # portal card title (required)
description: One shared shopping list for the whole house.
kind: static                     # static | hybrid | proxied | link
icon: /icon.svg                  # path inside the app, or an https URL
tags: [family, food]
private: false                   # true: requires the admin password
hidden: false                    # true: works but isn't listed on the portal

# static / hybrid
build: npm ci && npm run build   # optional; runs in a copy of the folder
output: dist                     # folder to serve (default: the app folder)

# hybrid (static files + your API) and proxied (your backend serves everything)
upstream: http://192.168.0.20:8000
api_prefix: /api                 # hybrid only
health_path: /healthz
upstream_insecure: false         # accept a self-signed upstream certificate

# link (portal card + redirect, e.g. a router or NAS admin page)
url: http://192.168.0.1/
```

Folders starting with `.` or `_` are ignored. `apps/groceries` is a
hand-written example, `apps/router` is a link, and `apps/builder` is the builder.

### The house theme

Every app host, the portal and the admin page serve a shared look at
`/_hearth/`, so apps match each other and switch between light and dark
together:

```html
<script src="/_hearth/hearth.js"></script>        <!-- first in <head> -->
<link rel="stylesheet" href="/_hearth/theme.css">   <!-- colours, type, base -->
<link rel="stylesheet" href="/_hearth/kit.css">     <!-- optional components -->
...
<button class="theme-toggle" data-hearth-theme-toggle></button>
```

- `theme.css` defines the tokens (`--bg`, `--card`, `--fg`, `--muted`,
  `--line`, `--accent`, `--ok`/`--warn`/`--danger`, radii, shadows, fonts) for
  light and dark. An app picks its colour with `--accent-light` and
  `--accent-dark`, and uses the variables for everything else.
- `kit.css` has ready-made header bar, cards, buttons, inputs, tabs, chips
  and notices. Both files are in CSS cascade layers, so an app's own CSS
  always wins.
- The toggle cycles Auto → Light → Dark. The choice is one cookie on the apps
  domain, so it applies to every app; `hearth.js` reads it from the server, so
  apps never touch cookies.
- `hearth.js` also reports uncaught errors and failed script loads to
  `/_hearth/errors` (rate limited, kept in memory). The App Builder shows them
  per app.

### Installing an app on a phone

Every app that loads `/_hearth/hearth.js` is installable: the script links a
web app manifest that the platform builds from `app.yaml` (title,
description, icon), with PNG icons rendered from the app's SVG icon. On
Android, open the app in Chrome and use ⋮ → Install app; on iOS, Share → Add
to Home Screen. The device must trust the house certificate first. An app
that ships its own `<link rel="manifest">` keeps it.

### Shared data for static apps

Every static or hybrid app gets a tiny key-value store at `/_api/data/<key>`
(JSON values up to 256 KB, 200 keys per app, scoped to that app). Copy
`templates/static-web/lib/data.js` into your app and use:

```js
import { load, save, remove, keys } from "./lib/data.js";
const items = await load("items", []);
await save("items", [...items, { text: "milk" }]);
```

Writes are last-write-wins, so reload right before saving. Data lives in
`<data>/appdata/<app>/` on the Mac.

### Asking Gemini from a static app

A hand-written app can opt in to the house's Gemini with `capabilities: [llm]`
in its `app.yaml`. It can then call its own `/_api/llm`:

```js
const res = await fetch("/_api/llm", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ system: "Reply with JSON only ...", prompt: text }),
});
const { text, model } = await res.json(); // text is the model's JSON reply
```

It uses the same Vertex AI setup as the App Builder (below). Limits: prompt
4 KB, system prompt 24 KB, 20 calls per 10 minutes per app, 90 s timeout.
Calls from other apps or other sites get 403, and generated apps can't ask
for the capability. Apps should treat a failure (403/429/502/503) as "no
model today" and fall back; `apps/astroscience` does.

### The apps in this repo

| App | What it is |
| --- | --- |
| `groceries` | Shared shopping list; the hand-written example of `/_api/data`. |
| `naal` | Today in a Tamil home: panchangam computed in the browser, festivals, weekday prayers and music. |
| `astroscience` | Learn Tamil astrology with a live chart. Opens on a step-by-step reading (each takeaway with its evidence and a link to the rule behind it), life areas ranked by support, the current dasha period, and an optional Gemini retelling; then the mechanics (grahas, houses, aspects, yogas), a cheat sheet and a reverse search ("find a moment"). Up to 20 saved birth profiles live in the app's data on the server (`<data>/appdata/astroscience/profiles.json`), never in this repository; famous example charts (Rama, Krishna, Modi, Vivekananda) ship with the app. |
| `builder` | The App Builder: build, change, preview, troubleshoot and roll back apps. |
| `router` | A link to the router's admin page. |

## The App Builder

`https://builder.apps.home` (admin password) asks for a name and a description,
or for a change to an app it built earlier. It then:

1. prompts Gemini on Vertex AI with `guardrails/BUILDER_RULES.md` and the
   starter template in `templates/static-web/`,
2. checks the result in code (`internal/builder/guard.go`): no external
   resources, no inline scripts, allowed file types and sizes only, and asks
   the model to fix any problems (up to 3 attempts),
3. writes `apps/<name>/` with the platform's own `lib/data.js` and an
   `app.yaml` marked `generated: true`,
4. commits and pushes to `main`, and deploys right away.

Generated apps are static only and are served with a strict
Content-Security-Policy, so even code that slipped past the checks can't load
or send anything off the box. The builder only revises apps it generated;
hand-written apps are never touched. To change how the builder writes apps,
edit the rules file or the template and push.

The builder is also where you look after apps. It lists every app (hand-written
ones read-only) with its deploy status and browser errors, and for each one:

- **Preview**: the live app in a phone, tablet or desktop frame. Generated
  apps allow only the builder to frame them.
- **Health**: checks that run without the model (deploy status, errors seen
  in browsers, guardrails, files that are linked but missing, house theme
  use), an optional Gemini code review, and a ready-made fix request you can
  edit and send as a change.
- **Change**: describe a change in plain words.
- **History**: every commit that touched the app, with the request that
  produced it. Restore any earlier version of a generated app; the restore is
  itself a new commit, so it can be undone.
- **Files** and **Logs**: the source as deployed, builder jobs, and the
  deploy build log.

Setup on the home Mac (once, as the user the service runs as):

```sh
brew install --cask google-cloud-sdk
gcloud auth login
gcloud config set project YOUR_PROJECT
gcloud services enable aiplatform.googleapis.com
gcloud auth application-default login
```

The model is set in config (`gemini_model`, default `gemini-4-argon`; use
`gemini-3.8-flash` to save money): `appshome init --gemini-model ...`.

## Developing on a laptop

```sh
make test        # unit tests, including a builder run against a fake Gemini
make check       # what CI checks about apps/, guardrails/ and templates/
make dev         # whole stack on ports 8080/8443, data in .dev-data/
```

`make dev` serves `apps/` straight from this checkout and rescans every
5 seconds, so edits show up immediately. It prints curl commands for each
host. For a browser, add `127.0.0.1 apps.home admin.apps.home groceries.apps.home`
to `/etc/hosts` and open `https://apps.home:8443` (admin password
`devpassword`). The builder in dev mode commits into your checkout.

## Installing on the home Mac

```sh
curl -fsSL https://github.com/keshy/hearth/releases/latest/download/install.sh | bash
```

That installs the latest release; no Go or checkout needed. Re-run it to
update the platform (apps update on their own). `HEARTH_VERSION=v0.1.0` pins
a release. From a checkout, `scripts/install.sh` builds from source instead
and deploys from that checkout's `origin` remote. The installer:

- installs Caddy with Homebrew (and Go, when building from source),
- points the service at `git@github.com:keshy/hearth.git` (override with
  `APPS_HOME_REPO_URL`; later runs keep whatever the config says) and
  records your gcloud project,
- asks for an admin password,
- installs LaunchDaemons for Caddy, `appshome serve` and the DNS server,
- offers to keep the Mac awake and restart it after power failures,
- runs `appshome doctor`.

The service pulls and the builder pushes without a prompt, so the Mac needs
an SSH key without a passphrase that can push to the repo, set up in
`~/.ssh/config` for the user the service runs as:

```
Host github.com
  IdentityFile ~/.ssh/p_github
  IdentitiesOnly yes
```

Nothing machine-specific is in config: the LAN IP, interface and router are
detected at runtime, and the DNS server restarts itself if the IP changes.

### Router (TP-Link: Advanced → Network → DHCP Server)

1. Address Reservation: reserve the Mac's IP for its MAC address. Turn off
   *Private Wi-Fi Address* on the Mac for this network, or use Ethernet.
2. Primary DNS: the Mac's IP. Secondary DNS: leave empty (devices would skip
   the Mac and `apps.home` would stop resolving at random).
3. On each device, open `http://apps.home/trust` once and install the
   certificate, then bookmark `https://apps.home`.

`appshome doctor` prints these steps with the real IP and MAC filled in.

## Commands

| Command | What it does |
| --- | --- |
| `appshome doctor` | Checks network, DNS, Caddy, repo, builder; prints router steps |
| `appshome deploy [--force]` | Deploy now instead of waiting for the next poll |
| `appshome set-password` | Change the admin password |
| `appshome init --flag value` | Change config (see `appshome init -h`) |
| `appshome caddyfile` | Print the generated Caddy config |
| `appshome check [--repo DIR]` | Validate app manifests and re-check generated apps against the guardrails |

## CI and releases

Every push and pull request runs `.github/workflows/ci.yml`: formatting,
`go vet`, tests, `appshome check` (which also catches a builder commit that
breaks the guardrails), a macOS build and a shell syntax check.

To release the platform, push a tag:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` tests again, runs `scripts/release.sh`
(bundles for Apple Silicon and Intel Macs plus `install.sh` and
`checksums.txt`), and publishes a GitHub Release. Tags with a dash
(`v0.2.0-rc1`) become pre-releases, which `latest` installs skip. App changes
never need a release; they deploy from `main`.

Data lives in `/opt/homebrew/var/apps-home` (`config.json`, `state.json`,
`releases/`, `live/`, `appdata/`, `caddy/`, `logs/`). Build logs are in
`logs/builds/<app>.log` and on the admin page. For nightly backups to Cloud
Storage, run the installer with `APPS_HOME_BACKUP_BUCKET=your-bucket`.

## Troubleshooting

- **`apps.home` doesn't resolve on a device:** check the router's DNS settings,
  then reconnect the device's Wi-Fi to pick up the new DHCP lease.
- **Certificate warning:** install the root certificate from `/trust` on that device.
- **An app didn't update:** check its status and build log on the admin page;
  `appshome deploy --force` retries.
- **Builder errors:** `appshome doctor` checks the GCP project and credentials.

## License

[Apache License 2.0](LICENSE)
