import fs from "fs";
import path from "path";

// Scoop configuration. Defaults live here in code; drop a scoop.config.json in
// DATA_DIR to override any part without a deploy (keyword lists are meant to
// be edited over time as scoring gets tuned).
export type ScoopConfig = {
  // CKAN dataset carrying the City of Tampa building permits (BLDS standard,
  // updated daily) — the automated discovery feed.
  ckanBase: string;
  ckanDatasetId: string;
  // Accela Citizen Access links, used for manual lookups from the lead queue.
  accelaSearchUrl: string;
  accelaDailyReportUrl: string;
  // Map of our normalized field -> candidate source column headers, matched
  // case-insensitively after stripping spaces/underscores. Raw columns are
  // always preserved verbatim in raw_json regardless of this map.
  fieldMap: Record<string, string[]>;
  // Scoring: [pattern, points, label]. Patterns match case-insensitively
  // against record type + description + project name.
  typeSignals: [string, number, string][];
  keywordSignals: [string, number, string][];
  brandSignals: [string, number, string][];
  valuationTiers: { min: number; points: number; label: string }[];
  highPriorityMin: number;
  watchMin: number;
};

const DEFAULTS: ScoopConfig = {
  ckanBase: "https://www.civicdata.com",
  ckanDatasetId: "tampa_permit_standard_permits_v11_17914",
  accelaSearchUrl: "https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?module=Building&TabName=Building",
  accelaDailyReportUrl: "https://aca-prod.accela.com/TAMPA/Report/ReportParameter.aspx?module=Building&reportID=478&reportType=LINK_REPORT_LIST",
  fieldMap: {
    // BLDS-standard names first, then common Accela export variants. Verified
    // against the real feed after the first fetch (see docs/TAMPA_DAILY_PERMIT_REPORT.md).
    permitId: ["permitnum", "permitnumber", "recordid", "recordnumber", "permit_no", "altid"],
    recordType: ["permitclassmapped", "permittype", "permitclass", "recordtype", "type", "worktype", "permittypedesc"],
    description: ["description", "workdescription", "projectdescription", "shortnotes", "permitdescription"],
    projectName: ["projectname", "project", "name"],
    address: ["originaladdress1", "address", "siteaddress", "fulladdress", "location"],
    city: ["originalcity", "city"],
    zip: ["originalzip", "zip", "zipcode", "postalcode"],
    parcel: ["pin", "parcelnumber", "parcelid", "folio", "folionumber", "parcel"],
    status: ["statuscurrent", "status", "currentstatus", "appstatus", "recordstatus"],
    appliedDate: ["applieddate", "applicationdate", "fileddate", "dateapplied", "opened", "createddate"],
    issuedDate: ["issueddate", "dateissued", "issuedate"],
    completedDate: ["completeddate", "finaleddate", "closeddate"],
    expiresDate: ["expiresdate", "expirationdate"],
    valuation: ["estprojectcost", "valuation", "jobvalue", "constructioncost", "declaredvaluation", "totalfees"],
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
    { min: 10_000_000, points: 5, label: "valuation > $10M" },
    { min: 1_000_000, points: 3, label: "valuation > $1M" },
    { min: 250_000, points: 2, label: "valuation > $250K" },
    { min: 100_000, points: 1, label: "valuation > $100K" },
  ],
  highPriorityMin: 8,
  watchMin: 4,
};

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

let cached: ScoopConfig | null = null;
export function scoopConfig(): ScoopConfig {
  if (cached) return cached;
  let overrides: Partial<ScoopConfig> = {};
  try {
    const p = path.join(dataDir(), "scoop.config.json");
    if (fs.existsSync(p)) overrides = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* bad JSON: fall back to defaults */ }
  cached = { ...DEFAULTS, ...overrides, fieldMap: { ...DEFAULTS.fieldMap, ...(overrides.fieldMap ?? {}) } };
  return cached;
}
