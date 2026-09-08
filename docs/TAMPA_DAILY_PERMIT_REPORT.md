# Tampa Daily Permit Report — schema

Status: PENDING FIRST REAL IMPORT.

This file documents the actual columns of the City of Tampa permit feed. It
gets filled in from real data, not guesses: after the first import, open
`/api/admin/scoop/schema` (or the Scoop panel) — it inventories every original
column name with fill rates and sample values straight from the stored
`raw_json`, and this doc is then written from that output.

## Sources

1. Automated (primary): City of Tampa building permits open dataset on
   CivicData (CKAN, BLDS standard, updated daily):
   https://www.civicdata.com/dataset/tampa_permit_standard_permits_v11_17914
   The fetcher resolves the newest CSV resource via the CKAN API
   (`/api/3/action/package_show`), so a re-uploaded resource never breaks it.
2. Manual: the Accela "Daily Permit Report" (reportID=478) exported by hand
   and uploaded in the Scoop panel:
   https://aca-prod.accela.com/TAMPA/Report/ReportParameter.aspx?module=Building&reportID=478&reportType=LINK_REPORT_LIST

Both run through the same pipeline. Original files are preserved verbatim
under `data/raw/tampa_daily_permits/YYYY-MM-DD/` with a content-hash prefix,
so a source report can never be overwritten.

## Field handling rules

- Every original column is stored unrenamed in `permits.raw_json`.
- Normalized fields are mapped via the editable `fieldMap` in
  `src/lib/scoop/config.ts` (override with `DATA_DIR/scoop.config.json`).
  Candidates cover the BLDS standard names plus common Accela export names;
  the map is corrected here once the real headers are inspected.
- The city's permit identifier (`permitnum` in BLDS) is the primary key.
  Deduplication is by that identifier, never by report date.
- `applied_date` is the city's filing date; `first_seen_at` is when OUR system
  first saw the record. A permit filed Sept. 6 that first appears in a
  Sept. 8 import is still NEW to us and surfaces as such.
- A field that goes blank in a later report keeps its previous value (exports
  omit columns more often than the city erases data); real changes are
  recorded in `permit_versions` as `{ field: { from, to } }`.

## Columns (to be completed from the schema report)

| Original column | Type | Fill rate | Sample values | Meaning |
| --- | --- | --- | --- | --- |
| (run the first import, then paste `/api/admin/scoop/schema` output here) | | | | |
