import http from "http";
import { collect } from "./collectors.mjs";
import { getLeads, importRecords, csvToObjects, lastImports, queueBands, schemaReport, getMeta, setMeta } from "./pipeline.mjs";
import { config } from "./config.mjs";

// Tampa Lead Desk — a standalone service. It owns its scheduler, database and
// raw archive, and keeps running regardless of what the magazine app is doing.
// The interface lives in Imago, which proxies here over the private compose
// network; this server never needs a public port. If LEADDESK_TOKEN is set,
// every request must carry it (defense in depth for a non-published port).

const PORT = Number(process.env.LEADDESK_PORT || 3100);
const TOKEN = process.env.LEADDESK_TOKEN || "";

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readBody(req, maxBytes = 100 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw new Error("Body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://leaddesk");
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  if (TOKEN && req.headers["x-leaddesk-token"] !== TOKEN) return json(res, 401, { error: "Unauthorized" });

  try {
    if (req.method === "GET" && url.pathname === "/leads") {
      const q = url.searchParams;
      const leads = getLeads({
        sinceDays: q.get("days") ? Number(q.get("days")) : undefined,
        onlyNew: q.get("new") === "1",
        onlyChanged: q.get("changed") === "1",
        restaurants: q.get("restaurants") === "1",
        development: q.get("development") === "1",
        minScore: q.get("minScore") ? Number(q.get("minScore")) : undefined,
      });
      return json(res, 200, { leads: leads.slice(0, 200), total: leads.length, bands: queueBands(leads), imports: lastImports(8), lastCollect: getMeta("last_collect_at") });
    }
    if (req.method === "POST" && url.pathname === "/collect") {
      const summary = await collect();
      setMeta("last_collect_at", new Date().toISOString());
      return json(res, 200, summary);
    }
    if (req.method === "POST" && url.pathname === "/import") {
      const filename = url.searchParams.get("filename") || "report.csv";
      const buf = await readBody(req);
      const records = csvToObjects(buf.toString("utf8"));
      return json(res, 200, importRecords(records, buf, filename, "manual"));
    }
    if (req.method === "GET" && url.pathname === "/schema") {
      return json(res, 200, { columns: schemaReport() });
    }
    return json(res, 404, { error: "Not found" });
  } catch (e) {
    return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

// ---- Scheduler: one collection per day at the configured UTC hour. ----
// Checked every 10 minutes; a run counts only when it succeeds, so a failed
// morning pull retries all day instead of silently skipping to tomorrow.
async function tick() {
  const hour = new Date().getUTCHours();
  if (hour < config().fetchHourUtc) return;
  const last = getMeta("last_collect_at");
  if (last && Date.now() - Date.parse(last) < 20 * 3600 * 1000) return;
  try {
    const s = await collect();
    setMeta("last_collect_at", new Date().toISOString());
    console.log(`[leaddesk] collected via ${s.collector}: ${s.rowCount} rows, ${s.inserted} new, ${s.changed} changed`);
  } catch (e) {
    console.error(`[leaddesk] collection failed: ${e instanceof Error ? e.message : e}`);
  }
}
setInterval(tick, 10 * 60 * 1000);
tick();

server.listen(PORT, () => console.log(`[leaddesk] listening on :${PORT}`));
