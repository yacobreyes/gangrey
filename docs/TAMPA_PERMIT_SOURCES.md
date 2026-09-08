# Tampa / Hillsborough permit data sources

Verified against live responses (fetched from a US residential connection,
pasted into the dev session) on 2026-09-10. This replaces every earlier guess:
the field names below are real.

## Network reality (governs any architecture)

- The Nuremberg VPS (Hetzner, 188.245.38.32) gets HTTP 403 from
  arcgis.tampagov.net, www.tampa.gov and www.civicdata.com (US-gov WAFs block
  non-US datacenter IPs). Confirmed by direct curl from the box.
- services.arcgis.com (Esri cloud, hosts the Hillsborough feed) — VPS
  reachability NOT YET TESTED. One curl decides whether server-side
  automation is possible from the existing box:
      curl -s -o /dev/null -w "%{http_code}\n" "https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer?f=json"
- A US residential browser reaches everything.
- Rule: no evading IP blocks (no proxies/VPNs/disguised traffic). Blocked
  hosts are collected from an allowed location (e.g. the reporter's browser)
  or not at all.

## Source 1 — City of Tampa: Planning/PermitsAll (VERIFIED)

Base: https://arcgis.tampagov.net/arcgis/rest/services/Planning/PermitsAll/FeatureServer
- One point layer: 0 "Permits". Description: "Permit data used in the
  Internal Active Permits viewer. Updated Daily." Copyright Tampa GIS.
- capabilities: Query. maxRecordCount 2000 (standard 32000 without geometry).
  Supports pagination, orderBy, statistics, geoJSON. Dates are epoch ms in
  America/New_York.
- Freshness: VERIFIED. max(LASTUPDATE) = 1788566400000 (Sept 4, 2026) when
  checked Sept 10, 2026 — actively maintained, with history back to at least
  2019 (low OBJECTIDs are old rows, so first-seen detection has a real
  baseline).

Fields (all confirmed):
| Field | Type | Notes |
| --- | --- | --- |
| OBJECTID | oid | row id, not stable across reloads — do not key on it |
| RECORD_ID | string(20) | Accela permit number, e.g. BDE-19-0439891 — THE primary key |
| PROJECTNAME1 / PROJECTNAME2 | string(200) | often blank / short label |
| PROJECTDESCRIPTION | string(300) | free text, scoring surface |
| ADDRESS / UNIT / ZIP | string | site address |
| PROJECTSTATUS | string(50) | e.g. "Issued" |
| NEWCONSTRUCTIONSF | int | square feet (no dollar valuation in this layer) |
| OCCUPANCYCATEGORY | string(100) | often blank in old rows |
| OCCUPANCYTYPE | string(100) | "Commercial" / "Residential" — cheap commercial filter |
| NBROFUNITS | int | units |
| PRIVATEPROVIDER | Yes/No | |
| STOPWORKORDER | Yes/No | newsworthy on its own |
| LASTUPDATE / CREATEDDATE | date (epoch ms ET) | change detection / filing date |
| CRA | string(50) | community redevelopment area, e.g. "East Tampa" |
| COUNCIL | string(10) | council district |
| NEIGHBORHOOD | string(100) | e.g. "North Ybor" |
| RECORDTYPE | string(100) | e.g. "Commercial Demolition Permit" |
| URL | string(500) | DIRECT Accela CapDetail link — free enrichment click-through |

Sample row (verbatim): RECORD_ID BDE-19-0439891, RECORDTYPE "Commercial
Demolition Permit", PROJECTDESCRIPTION "Demolition of one (1) story brick
building extenstion (28 x 14)", ADDRESS "2808 N 16th St", ZIP 33605,
PROJECTSTATUS Issued, OCCUPANCYTYPE Commercial, CRA "East Tampa",
NEIGHBORHOOD "North Ybor", URL https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?...

Missing from this layer: dollar valuation, contractor, applicant, owner.
Those live behind each record's Accela URL (manual click-through).

## Source 2 — Hillsborough County: AccelaDashBoard_MapService20211019 (PARTIALLY VERIFIED)

Base: https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer
- Esri cloud (not a .gov host) — the best candidate for server-side collection.
- Service description: "Accela Permits Dashboard Data Feeds Accela CO Issued
  Permits Dashboard". allowAnonymousToQuery true. hasStaticData false.
  maxRecordCount 2000. Export formats include csv/geojson.
- Layers: 0 GIS_Dashboard_Issued_CO_Merged (point — the data), 4 Issued
  (point), 3 CO / certificates of occupancy (point), 5 ZIP_USPS (polygon),
  6 Subdivisions (polygon; map dressing).
- A CO on a commercial address is a near-direct "business about to open"
  signal.
- Freshness: VERIFIED. Layer 0 dataLastEditDate = 1788524839406 (Sept 4-5,
  2026) when checked Sept 10, 2026. Dates on this service are UTC (unlike
  Tampa's, which are Eastern).

Layer 0 (GIS_Dashboard_Issued_CO_Merged) fields, all confirmed:
| Field | Type | Notes |
| --- | --- | --- |
| OBJECTID | oid | not stable — do not key on it |
| PERMIT__ | string(255) | the permit number (display field) — primary key |
| STATUS_1 | string | status |
| TYPE | string | full record type |
| TYPE2 | string(100) | 4-way rollup: Commercial/Residential x New Construction Starts/Others — free coarse filter |
| CATEGORY | string(12) | |
| DESCRIPTION | string (unbounded) | free text, scoring surface |
| ADDRESS / CITY_1 | string | CITY_1 says which jurisdiction in the county |
| PARCEL | string(255) | parcel id — the clustering key Tampa's layer lacks |
| Value | double | DOLLAR VALUATION — Tampa's layer lacks this too |
| OCCUPANCY_TYPE / OCCUPANCY_CATEGORY | string | restaurant/assembly detection |
| BEDROOMS / BATHROOMS / House_Cnt / Unit_Cnt / SF_Living / SF_Cover / SF_Total | numeric | project scale |
| ISSUED_DATE / COMPLETE_DATE / COMBINED_DATE | date (epoch ms UTC) | issue vs completion (CO) vs merged timeline |
| ACA_LINK | string(500) | direct Accela record link (county portal) |

Sample rows (verbatim, captured Sept 10 2026): PERMIT__ "COM05189",
STATUS_1 "Complete", TYPE "Commercial New Construction", PARCEL
"023867.0000", ADDRESS "5602 W Linebaugh Ave", CITY_1 "Tampa 33624",
CATEGORY "ISSUED", TYPE2 "Commercial New Construction Starts", ACA_LINK
https://aca-prod.accela.com/HCFL/Cap/CapDetail.aspx?... (agencyCode=HCFL).

Caveats learned from the samples:
- PERMIT__ is NOT unique: COM05190 appeared twice (same parcel/address,
  CATEGORY ISSUED both times, different ISSUED_DATE). The merged layer also
  mixes Issued and CO rows by design. Dedupe key must be composite
  (PERMIT__ + CATEGORY + ISSUED_DATE) or use layers 3/4 separately.
- Value / occupancy fields are null on older rows; fill rates need checking
  on recent data before scoring leans on them.
- CITY_1 carries jurisdiction + zip as one string ("Tampa 33624") — the
  county feed includes Tampa-area addresses under the HCFL (county) portal,
  so city/county overlap is real and must be handled, not assumed away.

## Source 3 — City of Tampa CKAN CSV on CivicData (fallback only)

https://www.civicdata.com/dataset/tampa_permit_standard_permits_v11_17914
BLDS-standard CSV, updated daily, resolvable via CKAN package_show. Blocked
for datacenter IPs (Cloudflare 403 from the VPS even with a browser UA).

## Source 4 — Accela Citizen Access (enrichment, manual)

Daily Permit Report generator (ASP.NET, not automated):
https://aca-prod.accela.com/TAMPA/Report/ReportParameter.aspx?module=Building&reportID=478&reportType=LINK_REPORT_LIST
Per-record detail pages: linked directly from Source 1's URL field.

## Prior art

The scrapped Lead Desk implementation (commits c620791..f8c6116, reverted in
3a8f688) contains a reusable pipeline design: verbatim raw preservation with
content-hash file dedupe, record dedupe by permit id (never report date),
first_seen_at distinct from filing date, field-change versioning with blank
protection, config-driven scoring, parcel/address clustering, ranked queue.
