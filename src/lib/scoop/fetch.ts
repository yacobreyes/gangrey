import { scoopConfig } from "./config";
import { importReport, type ImportSummary } from "./import";

// Automated retrieval: the City of Tampa publishes its building permits as an
// open dataset on CivicData (CKAN, BLDS standard, updated daily). This is a
// stable public download path — no scraping, no access controls. We resolve
// the CSV resource dynamically via the CKAN API so a re-uploaded resource URL
// never breaks the fetcher.
type CkanResource = { id?: string; url?: string; format?: string; last_modified?: string; name?: string };

export async function fetchLatestReport(): Promise<ImportSummary & { resourceUrl?: string }> {
  const cfg = scoopConfig();
  const metaUrl = `${cfg.ckanBase}/api/3/action/package_show?id=${encodeURIComponent(cfg.ckanDatasetId)}`;
  const metaRes = await fetch(metaUrl, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!metaRes.ok) throw new Error(`CKAN package_show failed: HTTP ${metaRes.status}`);
  const meta = await metaRes.json() as { success?: boolean; result?: { resources?: CkanResource[] } };
  const resources = meta.result?.resources ?? [];
  const csv = resources
    .filter(r => (r.format ?? "").toLowerCase() === "csv" && r.url)
    .sort((a, b) => (b.last_modified ?? "").localeCompare(a.last_modified ?? ""))[0];
  if (!csv?.url) throw new Error("No CSV resource found on the dataset");

  const fileRes = await fetch(csv.url, { cache: "no-store" });
  if (!fileRes.ok) throw new Error(`Report download failed: HTTP ${fileRes.status}`);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  const filename = (csv.name || csv.url.split("/").pop() || "tampa-permits.csv").slice(0, 120);
  const summary = importReport(buf, filename, "civicdata");
  return { ...summary, resourceUrl: csv.url };
}
