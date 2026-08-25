// Watchlist alerts: an hourly scan (piggybacked on the publish cron) across
// the trib tool's server-fetchable feeds, pushing a notification only when a
// NEW item matches a watchlist term. Seen ids persist in a sqlite singleton
// so restarts and repeat scans stay silent.
import { sqliteGetSingleton, sqliteSetSingleton } from "./storage/sqlite";
import { notify } from "./push";
import { fetchDeeds, fetchDistress, fetchWarn, fetchTampaMeetings, fetchBoccMeetings, watchHit, type DeedRow } from "./trib";

type WatchState = { lastRun?: number; seen?: string[] };
const KEY = "trib-watch";
const HOUR = 3600_000;
const MAX_SEEN = 4000;

export async function runTribWatchScan(): Promise<{ ran: boolean; alerts: number }> {
  const state = sqliteGetSingleton<WatchState>(KEY) ?? {};
  if (state.lastRun && Date.now() - state.lastRun < HOUR - 30_000) return { ran: false, alerts: 0 };
  const seen = new Set(state.seen ?? []);
  const firstRun = !state.seen;
  let alerts = 0;

  const candidates: { id: string; label: string; text: string; url: string }[] = [];

  const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch { /* a dead feed must not kill the scan */ } };

  await safe(async () => {
    const { rows } = await fetchDeeds();
    for (const d of rows as DeedRow[]) candidates.push({
      id: `deed-${d.instrument}`, label: "Deed",
      text: `${d.from} -> ${d.to} ${d.legal} $${d.price.toLocaleString("en-US")}`, url: "/trib",
    });
  });
  await safe(async () => {
    const { rows } = await fetchDistress();
    for (const d of rows) candidates.push({
      id: `lp-${d.instrument}`, label: "Lis pendens",
      text: `${d.from} -> ${d.to} ${d.legal}`, url: "/trib",
    });
  });
  await safe(async () => {
    const { items } = await fetchWarn();
    for (const w of items) candidates.push({
      id: `warn-${w.company}-${w.date}`, label: "WARN layoffs",
      // Every Hillsborough WARN row alerts regardless of watchlist: rare + newsworthy.
      text: `${w.company} (${w.employees || "?"} employees) ${w.date} WATCHALWAYS`, url: "/trib",
    });
  });
  await safe(async () => {
    const { items } = await fetchTampaMeetings();
    for (const m of items) candidates.push({ id: `mtg-${m.url}`, label: "Council meeting", text: m.title, url: "/trib" });
  });
  await safe(async () => {
    const { items } = await fetchBoccMeetings();
    for (const m of items) candidates.push({ id: `bocc-${m.url}`, label: "BOCC", text: m.title, url: "/trib" });
  });

  for (const c of candidates) {
    const isNew = !seen.has(c.id);
    seen.add(c.id);
    if (!isNew || firstRun) continue; // first run baselines silently
    const always = c.text.includes("WATCHALWAYS");
    const hit = watchHit(c.text);
    if (!hit && !always) continue;
    alerts++;
    if (alerts <= 5) notify({
      title: always ? `trib: ${c.label}` : `trib: ${c.label} · ${hit}`,
      body: c.text.replace(" WATCHALWAYS", "").slice(0, 160),
      url: c.url,
      tag: `trib-${c.label}`,
    });
  }
  if (alerts > 5) notify({ title: "trib: more watchlist hits", body: `${alerts - 5} additional new matches`, url: "/trib", tag: "trib-more" });

  sqliteSetSingleton(KEY, { lastRun: Date.now(), seen: [...seen].slice(-MAX_SEEN) });
  return { ran: true, alerts };
}
