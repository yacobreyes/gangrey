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
- **Backup = copy the `./data` folder** — or cron `scripts/backup-data.sh`
  for dated snapshots (keeps 14).

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
