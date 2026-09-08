# Tampa Lead Desk

A standalone reporting-desk service: collects the City of Tampa's daily
building-permit data on its own schedule, keeps a persistent database and a
verbatim raw archive, and serves a ranked reporting queue. It runs as its own
container and keeps working regardless of what the magazine app is doing.
Imago's Lead Desk panel is the interface (it proxies here over the private
compose network); this service exposes no public port.

## Collectors (in order)

1. ArcGIS — the city's own GIS server, `Planning/PermitsAll` FeatureServer
   (JSON, paged 2000 at a time).
2. CivicData — the city's CKAN open-data dataset (CSV, BLDS standard).

One collection per day at `fetchHourUtc` (default 11:00 UTC), retried through
the day until it succeeds. "Fetch now" in Imago triggers it on demand. Manual
uploads (e.g. the Accela Daily Permit Report export) go through the same
pipeline.

## Pipeline guarantees

- Original files preserved under `DATA_DIR/raw/tampa_daily_permits/YYYY-MM-DD/`
  with a content-hash prefix; a source report can never be overwritten.
- Whole-file re-imports refused by hash ("Report already imported").
- Deduplication by the city permit identifier, never report date.
- `first_seen_at` (ours) tracked separately from the city's filing date.
- Field changes versioned in `permit_versions`; blanks never clobber values.
- Scoring lists (types/keywords/brands/valuation) editable via
  `DATA_DIR/leaddesk.config.json` — no rebuild needed.
- Clustering by parcel, else normalized address.

## Run it

Comes up with the site: `docker compose up -d --build leaddesk`. Data lives in
`./data` (`leaddesk.db` + `raw/`), covered by the same backup as the magazine.

Local test: `node --test` is not wired; run `node pipeline.test.mjs`
(needs `npm install` here first, or a `node_modules` symlink to the repo root).

## After the first real collection

Open the Lead Desk panel, then `/api/admin/scoop/schema`, and paste the column
inventory into `docs/TAMPA_DAILY_PERMIT_REPORT.md` so the field map in
`config.mjs` gets verified against real headers instead of candidates.
