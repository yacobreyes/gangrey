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
