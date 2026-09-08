import { beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "leads-test-"));
process.env.DATA_DIR = tmp;

// Field shapes below are the VERIFIED live schemas (docs/TAMPA_PERMIT_SOURCES.md).
const tampaRow = (over: Record<string, unknown> = {}) => ({
  OBJECTID: 1, RECORD_ID: "BDE-26-0500001", RECORDTYPE: "Commercial Building Alterations",
  PROJECTNAME1: "", PROJECTNAME2: "Chipotle buildout", PROJECTDESCRIPTION: "Tenant buildout for restaurant, hood and Ansul",
  ADDRESS: "123 N Franklin St", UNIT: "", ZIP: "33602", PROJECTSTATUS: "Issued",
  NEWCONSTRUCTIONSF: 0, OCCUPANCYCATEGORY: "", OCCUPANCYTYPE: "Commercial", NBROFUNITS: 0,
  PRIVATEPROVIDER: "No", STOPWORKORDER: "No", LASTUPDATE: 1788566400000, CREATEDDATE: 1788480000000,
  CRA: "Downtown", COUNCIL: "5", NEIGHBORHOOD: "Downtown", RECORDTYPE2: "",
  URL: "https://aca-prod.accela.com/TAMPA/Cap/CapDetail.aspx?x=1", ...over,
});
const hcflRow = (over: Record<string, unknown> = {}) => ({
  OBJECTID: 9, PERMIT__: "COM99001", STATUS_1: "Issued", TYPE: "Commercial New Construction",
  COMPLETE_DATE: null, PARCEL: "023867.0000", ADDRESS: "5602 W Linebaugh Ave", CITY_1: "Tampa 33624",
  Value: 2400000, OCCUPANCY_TYPE: "Business", OCCUPANCY_CATEGORY: "", DESCRIPTION: "New Publix anchor store",
  BEDROOMS: null, BATHROOMS: null, House_Cnt: null, Unit_Cnt: null, SF_Living: null, SF_Cover: null,
  SF_Total: 45000, CATEGORY: "ISSUED", TYPE2: "Commercial New Construction Starts",
  ISSUED_DATE: 1788480000000, ACA_LINK: "https://aca-prod.accela.com/HCFL/Cap/CapDetail.aspx?y=2",
  COMBINED_DATE: 1788480000000, ...over,
});

describe("lead desk pipeline", () => {
  let ingestRecords: typeof import("./store").ingestRecords;
  let getQueue: typeof import("./store").getQueue;

  beforeAll(async () => {
    ({ ingestRecords, getQueue } = await import("./store"));
  });

  it("ingests both verified schemas and scores them", () => {
    const t = ingestRecords("tampa", [tampaRow()]);
    expect(t.inserted).toBe(1);
    const h = ingestRecords("hcfl", [hcflRow()]);
    expect(h.inserted).toBe(1);

    const q = getQueue({ minScore: 5 });
    expect(q.total).toBe(2);
    const tampaLead = q.leads.find(l => l.jurisdiction === "Tampa")!;
    const labels = tampaLead.reasons.map(r => r[1]);
    expect(labels).toContain("commercial alteration");
    expect(labels).toContain("Chipotle");
    const county = q.leads.find(l => l.parcel === "023867.0000")!;
    expect(county.reasons.map(r => r[1])).toContain("valuation > $1M");
    expect(county.reasons.map(r => r[1])).toContain("Publix");
  });

  it("hcfl duplicate permit numbers do not collide (composite uid)", () => {
    const s = ingestRecords("hcfl", [
      hcflRow({ OBJECTID: 20, PERMIT__: "COM05190", ISSUED_DATE: 1659657600000, COMBINED_DATE: 1659657600000, DESCRIPTION: "warehouse A", Value: null }),
      hcflRow({ OBJECTID: 21, PERMIT__: "COM05190", ISSUED_DATE: 1661731200000, COMBINED_DATE: 1661731200000, DESCRIPTION: "warehouse A", Value: null }),
    ]);
    expect(s.inserted).toBe(2); // distinct issue dates: two rows, no clobber
  });

  it("changes are versioned and blanks never clobber", () => {
    const s = ingestRecords("tampa", [tampaRow({ PROJECTSTATUS: "Complete", PROJECTDESCRIPTION: "", PROJECTNAME2: "", LASTUPDATE: 1788652800000 })]);
    expect(s.changed).toBe(1);
    const q = getQueue({ onlyChanged: true, includeDone: true });
    const p = q.leads[0].permits.find(x => x.permitNo === "BDE-26-0500001")!;
    expect(p.status).toBe("Complete");
    expect(p.description).toContain("Tenant buildout"); // blank did not clobber
  });

  it("stop work orders score high", () => {
    ingestRecords("tampa", [tampaRow({ RECORD_ID: "BDE-26-0500999", STOPWORKORDER: "Yes", ADDRESS: "9 Stop St", PROJECTNAME2: "", PROJECTDESCRIPTION: "framing" })]);
    const lead = getQueue({}).leads.find(l => l.address.includes("Stop St"))!;
    expect(lead.reasons.map(r => r[1])).toContain("stop work order");
  });

  it("an old completed permit is never NEW, even when first seen today", () => {
    ingestRecords("hcfl", [hcflRow({
      OBJECTID: 77, PERMIT__: "HOTEL-OLD-1", ADDRESS: "9999 Drury Ln", PARCEL: "999999.0000",
      STATUS_1: "Complete", DESCRIPTION: "New 8 story 210 room hotel",
      ISSUED_DATE: Date.now() - 500 * 86400_000, COMBINED_DATE: Date.now() - 500 * 86400_000,
    })]);
    const lead = getQueue({ includeDone: true }).leads.find(l => l.address === "9999 Drury Ln")!;
    expect(lead).toBeTruthy();
    expect(lead.isNew).toBe(false);
    expect(lead.completed).toBe(true);
    expect(lead.stale).toBe(true);
    // and by default a finished project is not in the queue at all
    expect(getQueue({}).leads.some(l => l.address === "9999 Drury Ln")).toBe(false);
    expect(getQueue({ onlyNew: true }).leads.some(l => l.address === "9999 Drury Ln")).toBe(false);
  });

  it("maintenance work is capped below the queue floor", () => {
    ingestRecords("tampa", [tampaRow({
      RECORD_ID: "BDE-26-0600001", RECORDTYPE: "Residential Building Alterations (Renovations)",
      PROJECTNAME2: "Plumbing Repair", ADDRESS: "12 Leak Ln", OCCUPANCYTYPE: "Residential",
      PROJECTDESCRIPTION: "EMERGENCY PLUMBING REPAIR. DEMO / REPLACE SLAB TO REPLACE SEWER LINES FOR TWO BATHROOMS AND KITCHEN",
    })]);
    const lead = getQueue({}).leads.find(l => l.address === "12 Leak Ln")!;
    expect(lead.topScore).toBeLessThanOrEqual(1);
    expect(getQueue({ minScore: 4 }).leads.some(l => l.address === "12 Leak Ln")).toBe(false);
    expect(getQueue({ restaurants: true }).leads.some(l => l.address === "12 Leak Ln")).toBe(false);
  });

  it("a remodel of an existing restaurant is capped; a new tenant buildout is not", () => {
    ingestRecords("tampa", [
      tampaRow({ RECORD_ID: "BDE-26-0800001", ADDRESS: "1050 Water St", PROJECTNAME2: "Wagamama", PROJECTDESCRIPTION: "Interior remodel of existing restaurant, bar refresh, new finishes" }),
      tampaRow({ RECORD_ID: "BDE-26-0800002", ADDRESS: "77 New Tenant Way", PROJECTNAME2: "Suite 100", PROJECTDESCRIPTION: "Tenant buildout for new restaurant with bar, hood and Ansul in vacant shell" }),
    ]);
    const remodel = getQueue({}).leads.find(l => l.address === "1050 Water St")!;
    const buildout = getQueue({}).leads.find(l => l.address === "77 New Tenant Way")!;
    expect(remodel.topScore).toBeLessThanOrEqual(3);
    expect(remodel.reasons.map(r => r[1])).toContain("remodel by the existing business (score capped)");
    expect(buildout.topScore).toBeGreaterThanOrEqual(10);
  });

  it("a new tenant arriving as a remodel of existing space is NOT capped", () => {
    ingestRecords("tampa", [tampaRow({
      RECORD_ID: "BDE-26-0526302", ADDRESS: "3644 W Kennedy Blvd",
      PROJECTNAME2: "EARLY START: PP:Interior remodel",
      PROJECTDESCRIPTION: "The Violet Stone Pizzeria - Early start for interior, non-structural work only. Remodel existing restaurant space for new pizzeria with bar",
    })]);
    const lead = getQueue({}).leads.find(l => l.address === "3644 W Kennedy Blvd")!;
    expect(lead.topScore).toBeGreaterThanOrEqual(8);
    expect(lead.reasons.map(r => r[1])).not.toContain("remodel by the existing business (score capped)");
    expect(getQueue({ restaurants: true }).leads.some(l => l.address === "3644 W Kennedy Blvd")).toBe(true);
  });

  it("county development-review applications ingest as plans and score by use type", () => {
    const r = ingestRecords("hcdev", [{
      objectid: 5, globalid: "{ABC-123}", RecordNum: "SIT-26-0042", ProjectName: "Brandon Crossing Hotel",
      ApplicationType: "Site Development", ProjectType: "Hotel", ApplicationGroup: "Commercial",
      Address: "1200 W Brandon Blvd", City: "Brandon", ParentFolio: "0738450000", ReviewStatus: "In Review",
      SubmissionDate: Date.now() - 3 * 86400_000, ApplicationStatusDate: Date.now() - 86400_000, EditDate: Date.now() - 86400_000,
      FootageProposedBldg: 88000, TotalResUnits: null, description: "New 6-story 140 room select-service hotel",
      ContactFirst: "Jane", ContactLast: "Doe", ContactPhone: "8135551212", ContactEmail: "jane@example.com",
      hillsgovhub: "https://hillsgovhub.example/SIT-26-0042",
    }]);
    expect(r.inserted).toBe(1);
    const lead = getQueue({ source: "hcdev" }).leads.find(l => l.address === "1200 W Brandon Blvd")!;
    expect(lead).toBeTruthy();
    expect(lead.isNew).toBe(true);
    expect(lead.reasons.map(x => x[1])).toContain("hotel plan filed");
    expect(lead.topScore).toBeGreaterThanOrEqual(8);
    expect(lead.permits[0].contact).toContain("Jane Doe");
    expect(lead.permits[0].isPlan).toBe(true);
  });

  it("live county plan rows: dbstatus, road parts and phone fallbacks are honored", () => {
    ingestRecords("hcdev", [{
      objectid: 34492, globalid: "d244db35", RecordNum: "HC-STRCON-26-0000161", ProjectName: "Thonotosassa Rd FWH Phase 2",
      ApplicationType: "Straight-to-Construction", ProjectType: "Residential", ResidentialType: "Mobile Home",
      Address: null, RoadPrefix: null, RoadName: "Thonotosassa", RoadType: "Rd", City: "Dover", ParentFolio: "081364.0500", folio: "0813640500",
      ReviewStatus: null, status: null, dbstatus: "In Progress", SubmissionDate: Date.now() - 2 * 86400_000, ApplicationStatusDate: Date.now() - 2 * 86400_000,
      EditDate: Date.now() - 86400_000, ContactFirst: "Christopher", ContactLast: "McNeal", ContactPhone: null, ContactPhone3: "8139681081",
      ContactEmail: "permitting@example.com", description: "6 FWH units with associated access & utility infrastructure.", hillsgovhub: "https://example/x",
    }]);
    const lead = getQueue({ source: "hcdev", minScore: 0 }).leads.find(l => l.address === "Thonotosassa Rd")!;
    expect(lead).toBeTruthy();
    expect(lead.permits[0].status).toBe("In Progress");
    expect(lead.permits[0].contact).toContain("8139681081");
    expect(lead.topScore).toBeLessThanOrEqual(3); // residential plan: low
  });

  it("alcohol permits carry the business name and score by class", () => {
    ingestRecords("tampaab", [{
      OBJECTID: 1, APP_NUM: "AB-26-0000321", BUS_NAME: "Sunset Social Club", BUS_OWNER_NAME: "Maria Lopez", BUS_PHONE: "8135550101",
      AB_CLASS_PREFIX: "Bar/Lounge/Nightclub (COP-Only)", ABSALECONDITION: "Consumption On Premises-Bar/Lounge/Nightclub", ABSALETYPE: "Beer/Wine/Liquor",
      HISTORY_ACTION: "Active", NUM: "1600", DIR: "E", STREET_NAME: "7th", TYPE: "Ave", PERMIT_ADDR: "1600 E 7th Ave", SEAT_COUNT: "220",
      AMPFD_SOUND: "Yes", CREATEDATE: Date.now() - 2 * 86400_000, LASTUPDATE: Date.now() - 86400_000, ACT_SUSP: "No",
    }, {
      OBJECTID: 2, APP_NUM: "AB-19-0000045", BUS_NAME: "Old Tavern", BUS_OWNER_NAME: "Pat Doe", AB_CLASS_PREFIX: "Bar/Lounge (COP-Only)",
      HISTORY_ACTION: "Active", PERMIT_ADDR: "9 Suspended St", CREATEDATE: Date.now() - 900 * 86400_000, LASTUPDATE: Date.now() - 86400_000,
      ACT_SUSP: "Yes", SUSP_ISSD: "0-30 days",
    }]);
    const club = getQueue({ source: "tampaab" }).leads.find(l => l.address === "1600 E 7th Ave")!;
    expect(club).toBeTruthy();
    expect(club.reasons.map(r => r[1])).toContain("nightclub alcohol permit");
    expect(club.permits[0].contact).toContain("Maria Lopez");
    expect(club.permits[0].description.startsWith("Sunset Social Club")).toBe(true);
    expect(getQueue({ restaurants: true, source: "tampaab" }).leads.some(l => l.address === "1600 E 7th Ave")).toBe(true);
    const susp = getQueue({ source: "tampaab" }).leads.find(l => l.address === "9 Suspended St")!;
    expect(susp.reasons.map(r => r[1])).toContain("alcohol license suspended or revoked");
  });

  it("a permit naming a business already licensed at the address is capped", () => {
    ingestRecords("tampaab", [{
      OBJECTID: 9, APP_NUM: "AB-22-0000900", BUS_NAME: "Wagamama", BUS_OWNER_NAME: "WGM LLC", AB_CLASS_PREFIX: "Restaurant (COP-Only)",
      HISTORY_ACTION: "Active", PERMIT_ADDR: "1050 Water St", ORD_LTR_DT: Date.now() - 900 * 86400_000, LASTUPDATE: Date.now() - 86400_000,
    }]);
    ingestRecords("tampa", [tampaRow({
      RECORD_ID: "BDE-26-0900001", ADDRESS: "1050 Water St", PROJECTNAME2: "Wagamama Pan Asian Block F2 Ground Floor",
      PROJECTDESCRIPTION: "Interior work at restaurant and bar",
    })]);
    const lead = getQueue({ source: "tampa" }).leads.find(l => l.address === "1050 Water St" && l.permits.some(p => p.permitNo === "BDE-26-0900001"))
      ?? getQueue({ minScore: 0 }).leads.find(l => l.permits.some(p => p.permitNo === "BDE-26-0900001"))!;
    expect(lead).toBeTruthy();
    expect(lead.permits.some(p => p.permitNo === "BDE-26-0900001")).toBe(true);
    // The cap leaves the whole cluster (one permit) at 3 or below.
    expect(lead.topScore).toBeLessThanOrEqual(3);
    expect(lead.reasons.map(r => r[1]).some(l => /already licensed here/.test(l))).toBe(true);
  });

  it("identical batches are refused by hash", () => {
    const rows = [tampaRow({ RECORD_ID: "BDE-26-0700000" })];
    ingestRecords("tampa", rows);
    expect(ingestRecords("tampa", rows).alreadyIngested).toBe(true);
  });

  it("raw batches are preserved on disk", () => {
    const dir = path.join(tmp, "raw", "leads");
    const days = fs.readdirSync(dir);
    expect(fs.readdirSync(path.join(dir, days[0])).length).toBeGreaterThan(0);
  });
});
