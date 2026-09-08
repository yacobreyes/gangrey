import { beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Point the scoop db + raw storage at a temp dir BEFORE importing the module.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scoop-test-"));
process.env.DATA_DIR = tmp;

const HEADERS = "PermitNum,PermitType,Description,OriginalAddress1,PIN,StatusCurrent,AppliedDate,EstProjectCost,ContractorCompanyName";
const csv = (rows: string[]) => Buffer.from([HEADERS, ...rows].join("\n"));

describe("scoop import pipeline", () => {
  let importReport: typeof import("./import").importReport;
  let getLeads: typeof import("./leads").getLeads;

  beforeAll(async () => {
    ({ importReport } = await import("./import"));
    ({ getLeads } = await import("./leads"));
  });

  it("imports, preserves raw, scores and clusters", () => {
    const s = importReport(csv([
      'BLD-1001,Commercial Building Alterations,"Tenant buildout for new restaurant, hood and Ansul system",123 MAIN ST,PARCEL-9,In Review,2026-09-06,1400000,ACME BUILDERS',
      "BLD-1002,Commercial Mechanical Trade Permit,Kitchen hood install,123 MAIN ST,PARCEL-9,In Review,2026-09-06,80000,",
      "BLD-2000,Residential Fence,Backyard fence,55 OAK AVE,,Issued,2026-09-05,4000,",
    ]), "day1.csv", "manual");
    expect(s.alreadyImported).toBe(false);
    expect(s.rowCount).toBe(3);
    expect(s.inserted).toBe(3);

    const leads = getLeads({ minScore: 5 });
    expect(leads.length).toBe(1);
    const lead = leads[0];
    expect(lead.permitCount).toBe(2);          // clustered by parcel
    expect(lead.address).toBe("123 MAIN ST");
    expect(lead.topScore).toBeGreaterThanOrEqual(10);
    const labels = lead.reasons.map(r => r[1]);
    expect(labels).toContain("commercial alteration");
    expect(labels).toContain("restaurant");
    expect(labels).toContain("valuation > $1M");
  });

  it("refuses the exact same file twice", () => {
    const buf = csv(["BLD-1001,Commercial Building Alterations,Same,123 MAIN ST,PARCEL-9,In Review,2026-09-06,1400000,X"]);
    importReport(buf, "dupe.csv", "manual");
    const again = importReport(buf, "dupe.csv", "manual");
    expect(again.alreadyImported).toBe(true);
  });

  it("dedupes by permit id, versions changes, keeps blanks from clobbering", () => {
    const s = importReport(csv([
      // Status changed, valuation blank in this export: change recorded, valuation kept.
      "BLD-1001,Commercial Building Alterations,\"Tenant buildout for new restaurant, hood and Ansul system\",123 MAIN ST,PARCEL-9,Issued,2026-09-06,,ACME BUILDERS",
      "BLD-1002,Commercial Mechanical Trade Permit,Kitchen hood install,123 MAIN ST,PARCEL-9,In Review,2026-09-06,80000,",
    ]), "day2.csv", "manual");
    expect(s.changed).toBe(1);
    expect(s.unchanged).toBe(1);
    const lead = getLeads({ onlyChanged: true })[0];
    expect(lead).toBeTruthy();
    const p = lead.permits.find(x => x.permitId === "BLD-1001")!;
    expect(p.status).toBe("Issued");
    expect(p.valuation).toBe(1400000);         // blank did not clobber
  });

  it("raw file is preserved on disk", () => {
    const dir = path.join(tmp, "raw", "tampa_daily_permits");
    const days = fs.readdirSync(dir);
    expect(days.length).toBeGreaterThan(0);
    const files = fs.readdirSync(path.join(dir, days[0]));
    expect(files.some(f => f.endsWith("day1.csv"))).toBe(true);
  });
});
