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

## Backups (offsite, continuous)

The database replicates continuously to object storage with
[Litestream](https://litestream.io): it ships write-ahead log frames every 10
seconds rather than copying the file on a schedule, so the worst case after
losing the box is roughly ten seconds of writing, and you can restore to *any*
moment in the retention window rather than only to last night.

It is off until you configure it. Add to `.env.selfhost`, then redeploy:

    LITESTREAM_REPLICA_URL=s3://your-bucket/imago
    LITESTREAM_ACCESS_KEY_ID=...
    LITESTREAM_SECRET_ACCESS_KEY=...
    # Only for non-AWS S3-compatible storage (Cloudflare R2, Backblaze B2,
    # Hetzner, MinIO). Leave unset on AWS itself.
    LITESTREAM_ENDPOINT=https://<account>.r2.cloudflarestorage.com
    LITESTREAM_REGION=auto

With those set, `docker-entrypoint.sh` wraps the app in `litestream replicate`.
With them unset the app boots exactly as before, so a missing bucket can never
keep the site down.

Retention is 24h of WAL with a daily snapshot (`litestream.yml`), meaning
point-in-time restore anywhere in the last day.

**Restoring.** `restore.sh` pulls the database into a side file and prints the
commands to swap it in. It deliberately does not overwrite the live database,
because in an incident you want to look at the restored copy first:

    ./restore.sh                        # newest available state
    ./restore.sh 2026-07-25T14:30:00Z   # as of that UTC moment

**Automatic recovery.** If the container starts and finds no database but a
replica exists, it restores before serving. Replacing a destroyed box is
therefore: bring up the container with the same `.env.selfhost`.

**What is not covered.** This replicates the database only. Uploaded media
under `data/media` is not included, so sync that separately, e.g.

    rclone sync ./data/media remote:your-bucket/media

## Notifications

Imago can push a notification to your phone when something happens, instead of
you opening it to check: a submission arrives, a member's card fails, a new
member joins, or the scheduled cron publishes and sends.

Generate the signing keys once. On the server there is no `node_modules` on the
host (everything installs inside the Docker image), so run it through Docker,
which is always available there:

    cd ~/gangrey
    docker run --rm -v "$PWD":/w -w /w node:22-slim node scripts/gen-vapid.mjs

(Plain `node scripts/gen-vapid.mjs` works too anywhere Node is installed. The
script deliberately uses only Node's built-in crypto, no dependencies.)

Add the three lines it prints to `.env.selfhost`, then `./deploy.sh`:

    VAPID_PUBLIC_KEY=...
    VAPID_PRIVATE_KEY=...
    VAPID_SUBJECT=mailto:you@gangrey.org

Then in Imago open **More → Notifications** and turn them on for the device.
Each device subscribes separately, and there's a "Send a test" button to
confirm the chain works.

Without the keys nothing breaks: the toggle explains it isn't set up and
`notify()` is a no-op, like the other optional integrations.

**On iPhone**, web push only reaches a site added to the home screen. Open
gangrey.org/admin/imago in Safari, Share → Add to Home Screen, then turn
notifications on from inside that app. The toggle says so if it detects you're
in a normal Safari tab.

Regenerating the keys unsubscribes every device, so do it once.

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
