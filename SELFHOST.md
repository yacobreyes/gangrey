# Imago — self-hosted mode

Run the whole CMS + site with no external services: everything lives in a
single SQLite file + a media folder on disk. No Sanity, no Vercel — any
machine that runs Docker works.

## Quick start

    cp .env.selfhost.example .env.selfhost   # fill in auth vars
    docker compose up --build

Site on http://localhost:3000 — admin at /admin/imago.

## How it works

- `STORAGE_BACKEND=sqlite` switches the entire data layer from Sanity to a
  local SQLite database (`DATA_DIR/imago.db`). Unset, everything uses Sanity
  exactly as before — gangrey.org is unaffected.
- Media uploads land in `DATA_DIR/media`, served at `/media/*`.
- `STANDALONE=1` at build time produces a plain Node server (`server.js`)
  instead of Vercel serverless functions.
- **Backup = copy the `./data` folder** — or run `./backup.sh` for a dated,
  consistent snapshot (SQLite `.backup` + media, keeps the last 14). Install
  the nightly cron once with `./backup.sh --install`. (Hetzner Cloud Backups on
  the server already covers whole-machine, off-box, 7-day rolling images; this
  script is an optional extra for finer-grained / longer retention.)

## What runs on the sqlite backend

Posts (draft/publish/schedule/trash), version history, newsletters +
versions + issue sync, subscribers (signup/unsubscribe/admin), members
(Stripe webhook, comp/revoke, paywall), users/roles, edit locks, media
uploads + library, about/welcome/lately, the Wayback archive importer,
all public pages.

Not ported (Sanity-only, gracefully absent): comments, like counts,
read counters, newsletter open tracking.

## Optional integrations

Stripe (paid memberships) and Resend (newsletter + magic-link email) are
config, not requirements — leave their env vars empty and those features
simply don't run.

## Deploying updates

On the server, run the zero-downtime deploy script — it pulls, builds the new
image while the old container keeps serving, then swaps:

    cd ~/gangrey && git pull && ./deploy.sh

`deploy.sh` refuses to build unless swap is active (a Next.js + sharp build
OOM-kills itself on a 4GB box without it) and waits for a local 200 before
declaring success.

## Scheduled publishing

Scheduling posts and newsletters needs a periodic tick (there's no Vercel cron
here). Set `CRON_SECRET` in `.env.selfhost` (any long random string —
`openssl rand -hex 32`), redeploy, then install the cron once:

    ./publish-cron.sh --install   # runs every 5 minutes

Each tick flips due scheduled posts to published and sends due scheduled
newsletters. (Scheduled posts already appear in listings at their time via a
query filter; this also flips their status and, crucially, sends newsletters.)

## www subdomain

Only the bare `gangrey.org` has HTTPS by default. To serve `www.gangrey.org`
too, point a DNS `A`/`CNAME` record for `www` at the server, then add a redirect
block to `/etc/caddy/Caddyfile` so www lands on the canonical bare domain:

    www.gangrey.org {
        redir https://gangrey.org{uri} permanent
    }

Then `sudo systemctl reload caddy`. Caddy fetches the cert automatically.
