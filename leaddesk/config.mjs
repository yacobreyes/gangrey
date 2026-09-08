import fs from "fs";
import path from "path";

// Tampa Lead Desk configuration. Defaults here; drop a leaddesk.config.json in
// DATA_DIR to override any part (the scoring lists are meant to be tuned).
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

const DEFAULTS = {
  // Collector 1 (primary): the City of Tampa's own ArcGIS server — city-run,
  // JSON, no WAF. Resolved layer by layer at run time.
  arcgisBase: "https://arcgis.tampagov.net/arcgis/rest/services/Planning/PermitsAll/FeatureServer",
  // Collector 2 (fallback): the city's CivicData CKAN dataset (CSV, BLDS).
  ckanBase: "https://www.civicdata.com",
  ckanDatasetId: "tampa_permit_standard_permits_v11_17914",
  // Where a lead's "open the source record" link points.
  accelaSearchUrl: "https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?module=Building&TabName=Building",
  // Daily collection hour, UTC (11 = 7am New York in daylight time).
  fetchHourUtc: 11,
  // normalized field -> candidate source column/attribute names, matched
  // case-insensitively with punctuation stripped. Raw fields are always
  // preserved verbatim regardless of this map.
  fieldMap: {
    permitId: ["permitnum", "permitnumber", "recordid", "recordnumber", "permit_no", "altid", "objectid"],
    recordType: ["permitclassmapped", "permittype", "permitclass", "recordtype", "type", "worktype", "permittypedesc"],
    description: ["description", "workdescription", "projectdescription", "shortnotes", "permitdescription"],
    projectName: ["projectname", "project", "name"],
    address: ["originaladdress1", "address", "siteaddress", "fulladdress", "location"],
    parcel: ["pin", "parcelnumber", "parcelid", "folio", "folionumber", "parcel"],
    status: ["statuscurrent", "status", "currentstatus", "appstatus", "recordstatus"],
    appliedDate: ["applieddate", "applicationdate", "fileddate", "dateapplied", "opened", "createddate"],
    issuedDate: ["issueddate", "dateissued", "issuedate"],
    valuation: ["estprojectcost", "valuation", "jobvalue", "constructioncost", "declaredvaluation"],
    contractor: ["contractorcompanyname", "contractorname", "contractor", "contractorcompanydesc"],
    applicant: ["applicantname", "applicant"],
    owner: ["ownername", "owner"],
    link: ["link", "url", "permiturl", "recordlink"],
  },
  typeSignals: [
    ["commercial.*(alteration|renovation)", 4, "commercial alteration"],
    ["commercial.*(new construction|addition)", 5, "commercial new construction"],
    ["commercial.*demolition", 4, "commercial demolition"],
    ["commercial.*fire", 2, "fire trade permit"],
    ["commercial.*mechanical", 2, "mechanical trade permit"],
    ["commercial.*plumbing", 2, "plumbing trade permit"],
    ["commercial.*site", 2, "site trade permit"],
    ["\\bcommercial\\b", 1, "commercial"],
  ],
  keywordSignals: [
    ["restaurant", 5, "restaurant"], ["\\bcafe\\b|\\bcafé\\b", 4, "cafe"], ["coffee", 4, "coffee"],
    ["\\bbar\\b|cocktail|lounge", 3, "bar"], ["brewery|brewing|taproom|tap room", 5, "brewery/taproom"],
    ["pizza|pizzeria", 4, "pizza"], ["\\bgrill\\b", 3, "grill"], ["kitchen", 3, "kitchen"],
    ["tenant (buildout|build-out|build out|improvement)", 4, "tenant buildout"],
    ["\\bhood\\b", 4, "kitchen hood"], ["grease", 4, "grease system"], ["ansul", 5, "Ansul fire suppression"],
    ["drive.?thr(u|ough)", 4, "drive-through"],
    ["hotel|apartments|mixed.?use|multifamily|multi-family", 3, "large development"],
    ["stadium|arena|tower", 3, "major project"],
  ],
  brandSignals: [
    ["chick.?fil.?a", 6, "Chick-fil-A"], ["starbucks", 6, "Starbucks"], ["chipotle", 6, "Chipotle"],
    ["mcdonald", 5, "McDonald's"], ["wawa", 5, "Wawa"], ["publix", 6, "Publix"], ["whataburger", 6, "Whataburger"],
    ["trader joe", 7, "Trader Joe's"], ["whole foods", 7, "Whole Foods"], ["costco", 7, "Costco"],
    ["raising cane", 6, "Raising Cane's"], ["dutch bros", 6, "Dutch Bros"], ["shake shack", 6, "Shake Shack"],
    ["in.?n.?out", 7, "In-N-Out"], ["texas roadhouse", 5, "Texas Roadhouse"], ["olive garden", 5, "Olive Garden"],
    ["aldi", 5, "Aldi"], ["sprouts", 5, "Sprouts"], ["target", 5, "Target"], ["amazon", 5, "Amazon"],
  ],
  valuationTiers: [
    { min: 10000000, points: 5, label: "valuation > $10M" },
    { min: 1000000, points: 3, label: "valuation > $1M" },
    { min: 250000, points: 2, label: "valuation > $250K" },
    { min: 100000, points: 1, label: "valuation > $100K" },
  ],
  highPriorityMin: 8,
  watchMin: 4,
};

let cached = null;
export function config() {
  if (cached) return cached;
  let overrides = {};
  try {
    const p = path.join(DATA_DIR, "leaddesk.config.json");
    if (fs.existsSync(p)) overrides = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* bad JSON: run on defaults */ }
  cached = { ...DEFAULTS, ...overrides, fieldMap: { ...DEFAULTS.fieldMap, ...(overrides.fieldMap ?? {}) } };
  return cached;
}
