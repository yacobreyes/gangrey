# Imago — self-hosted mode

Run the whole CMS + site with no external services: content lives in a single
SQLite file on disk. No Sanity, no Vercel — any machine that runs Docker works.

## Quick start

    cp .env.selfhost.example .env.selfhost   # fill in auth vars
    docker compose up --build

Site on http://localhost:3000 — admin at /admin/imago.

## How it works

- `STORAGE_BACKEND=sqlite` switches the data layer from Sanity to a local
  SQLite database (`DATA_DIR/imago.db`). Unset, everything uses Sanity exactly
  as before — gangrey.org is unaffected by this branch.
- `STANDALONE=1` at build time produces a plain Node server (`server.js`)
  instead of Vercel serverless functions.
- **Backup = copy the `./data` folder.** That's the entire state.

## Prototype status

Working on sqlite: posts (write/publish/schedule/trash), version history,
about/welcome/lately singletons, public pages, story paywall gating.
Still Sanity-only (next steps): newsletters, subscribers, members, media
library uploads, comments/likes.
