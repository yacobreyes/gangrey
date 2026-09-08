import fs from "fs"; import os from "os"; import path from "path"; import assert from "assert";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leaddesk-"));
const { importRecords, csvToObjects, getLeads } = await import("./pipeline.mjs");
const H = "PermitNum,PermitType,Description,OriginalAddress1,PIN,StatusCurrent,AppliedDate,EstProjectCost";
const csv = rows => Buffer.from([H, ...rows].join("\n"));
let s = importRecords(csvToObjects(csv([
  'BLD-1,Commercial Building Alterations,"Tenant buildout for restaurant, hood and Ansul",123 MAIN ST,P9,In Review,2026-09-06,1400000',
  "BLD-2,Commercial Mechanical Trade Permit,Kitchen hood install,123 MAIN ST,P9,In Review,2026-09-06,80000",
  "BLD-3,Residential Fence,Fence,55 OAK AVE,,Issued,2026-09-05,4000",
]).toString()), csv(["a"]), "day1.csv", "manual");
assert.equal(s.inserted, 3);
let leads = getLeads({ minScore: 5 });
assert.equal(leads.length, 1);
assert.equal(leads[0].permitCount, 2);
assert(leads[0].topScore >= 10);
// ArcGIS-shaped records (attribute objects, epoch dates)
s = importRecords([{ PermitNum: "BLD-9", PermitType: "Commercial New Construction", Description: "New Chipotle drive-thru", OriginalAddress1: "77 ELM ST", PIN: "", StatusCurrent: "Applied", AppliedDate: 1757116800000, EstProjectCost: 2000000 }], Buffer.from("arc1"), "arc.json", "arcgis");
assert.equal(s.inserted, 1);
const chip = getLeads({ restaurants: true }).find(l => l.address === "77 ELM ST");
assert(chip && chip.reasons.some(r => r[1] === "Chipotle"));
assert(chip.permits[0].appliedDate === "2025-09-06" || chip.permits[0].appliedDate === "2025-09-05");
// change + blank protection
s = importRecords(csvToObjects(csv(['BLD-1,Commercial Building Alterations,"Tenant buildout for restaurant, hood and Ansul",123 MAIN ST,P9,Issued,2026-09-06,']).toString()), Buffer.from("day2"), "day2.csv", "manual");
assert.equal(s.changed, 1);
const l2 = getLeads({ onlyChanged: true })[0];
const p = l2.permits.find(x => x.permitId === "BLD-1");
assert.equal(p.status, "Issued");
assert.equal(p.valuation, 1400000);
// exact dupe file
assert.equal(importRecords([], Buffer.from("day2"), "again.csv", "manual").alreadyImported, true);
console.log("leaddesk pipeline OK");
