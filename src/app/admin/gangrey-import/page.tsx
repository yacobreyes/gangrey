"use client";

import { useEffect, useRef, useState } from "react";

type BatchResult = {
  total: number; offset: number; nextOffset: number; processed: number;
  parsed: number; written: number; done: boolean;
  results: { headline?: string; slug?: string; skipped?: string; error?: string }[];
  error?: string;
};

export default function GangreyImportPage() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [written, setWritten] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [dry, setDry] = useState(false);
  const [resumeOffset, setResumeOffset] = useState<number | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [deduping, setDeduping] = useState(false);
  const [dedupResult, setDedupResult] = useState<string | null>(null);
  const [buildingMap, setBuildingMap] = useState(false);
  const [mapResult, setMapResult] = useState<string | null>(null);
  const [feedProbeOffset, setFeedProbeOffset] = useState(0);
  const [feedProbeResult, setFeedProbeResult] = useState<string | null>(null);
  const [probingFeed, setProbingFeed] = useState(false);

  useEffect(() => {
    fetch("/api/admin/import-gangrey/count")
      .then(r => r.json())
      .then(d => { if (typeof d.count === "number") setSavedCount(d.count); })
      .catch(() => {});
  }, []);

  const stopRef = useRef(false);

  function append(line: string) { setLog(l => [line, ...l].slice(0, 400)); }

  async function run(startOffset = 0) {
    setRunning(true); setDone(false); stopRef.current = false; setHasRun(true);
    if (startOffset === 0) { setProcessed(0); setWritten(0); setLog([]); }
    setResumeOffset(null);
    let offset = startOffset;
    let totalWritten = startOffset === 0 ? 0 : written;
    let retries = 0;
    const MAX_RETRIES = 5;

    try {
      while (!stopRef.current) {
        let res: Response;
        let data: BatchResult;
        try {
          res = await fetch(`/api/admin/import-gangrey?offset=${offset}&limit=10${dry ? "&dry=1" : ""}`);
          data = await res.json();
        } catch (e) {
          // Network blip — auto-retry up to MAX_RETRIES with backoff
          if (retries < MAX_RETRIES) {
            retries++;
            const wait = retries * 3000;
            append(`⏳ Network error, retrying in ${wait / 1000}s… (${retries}/${MAX_RETRIES})`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          append(`❌ ${String(e)}`);
          setResumeOffset(offset);
          break;
        }

        if (!res.ok || data.error) {
          if (retries < MAX_RETRIES) {
            retries++;
            const wait = retries * 3000;
            append(`⏳ Error: ${data.error ?? res.statusText} — retrying in ${wait / 1000}s… (${retries}/${MAX_RETRIES})`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          append(`❌ ${data.error ?? res.statusText}`);
          setResumeOffset(offset);
          break;
        }

        retries = 0; // reset on success
        setTotal(data.total);
        setProcessed(p => p + data.processed);
        totalWritten += data.written;
        setWritten(totalWritten);
        for (const r of data.results) {
          if (r.headline) append(`✅ ${r.headline}`);
          else if (r.skipped) append(`· skipped`);
          else if (r.error) append(`⚠️ ${r.error}`);
        }
        offset = data.nextOffset;
        if (data.done) {
          setDone(true); setResumeOffset(null);
          append(`— Finished. ${totalWritten} stories imported. —`);
          // Refresh the saved count
          fetch("/api/admin/import-gangrey/count").then(r => r.json())
            .then(d => { if (typeof d.count === "number") setSavedCount(d.count); }).catch(() => {});
          break;
        }
        await new Promise(r => setTimeout(r, 400));
      }
      if (stopRef.current) setResumeOffset(offset);
    } finally {
      setRunning(false);
    }
  }

  async function runDedup() {
    setDeduping(true); setDedupResult(null);
    try {
      const res = await fetch("/api/admin/import-gangrey/dedup", { method: "POST" });
      const data = await res.json();
      if (data.error) { setDedupResult(`❌ ${data.error}`); return; }
      setDedupResult(`✅ Deleted ${data.deleted} duplicate${data.deleted !== 1 ? "s" : ""} — ${data.kept} stories remain.`);
      fetch("/api/admin/import-gangrey/count").then(r => r.json())
        .then(d => { if (typeof d.count === "number") setSavedCount(d.count); }).catch(() => {});
    } catch (e) {
      setDedupResult(`❌ ${String(e)}`);
    } finally {
      setDeduping(false);
    }
  }

  // Harvest exact publication dates from Wayback's RSS-feed snapshots, looping
  // by offset until every captured feed snapshot is processed. Run this BEFORE
  // importing so stories get exact dates; then do a fresh import to apply them.
  async function buildMap() {
    setBuildingMap(true); setMapResult(null);
    let offset: number | null = 0;
    let retries = 0;
    try {
      while (offset !== null) {
        let data: { totalCaptures: number; processedSnapshots: number; totalMapped: number; done: boolean; nextOffset: number | null; error?: string };
        try {
          const res = await fetch(`/api/admin/import-gangrey?buildfeeds=1&offset=${offset}&limit=30`);
          data = await res.json();
        } catch {
          if (retries++ < 5) {
            setMapResult(`⏳ Network blip at snapshot ${offset}, retrying…`);
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          setMapResult(`❌ Gave up at snapshot ${offset}`);
          break;
        }
        if (data.error) { setMapResult(`❌ ${data.error}`); break; }
        retries = 0;
        setMapResult(`Harvesting feeds — ${data.processedSnapshots}/${data.totalCaptures} snapshots · ${data.totalMapped} exact dates…`);
        if (data.done) {
          setMapResult(`✅ Date map complete — ${data.totalMapped} exact dates from ${data.totalCaptures} feed snapshots. Now run a fresh import to apply them.`);
          break;
        }
        offset = data.nextOffset;
        await new Promise(r => setTimeout(r, 300));
      }
    } finally {
      setBuildingMap(false);
    }
  }

  const pct = total ? Math.round((processed / total) * 100) : 0;
  const btnStyle = (primary: boolean): React.CSSProperties => ({
    background: primary ? "#490000" : "#fff",
    color: primary ? "#fff" : "#490000",
    border: primary ? "none" : "1px solid #490000",
    borderRadius: 6, padding: "12px 22px", fontWeight: 700, fontSize: 15,
    cursor: running ? "default" : "pointer", opacity: running ? 0.6 : 1,
  });

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "3rem 1.5rem", fontFamily: "var(--font-subhead)", color: "#000000" }}>
      <h1 style={{ fontFamily: 'var(--font-cormorant), Georgia, serif', fontSize: 40, margin: "0 0 4px" }}>Gangrey Archive Import</h1>
      {savedCount !== null && (
        <p style={{ fontFamily: "var(--font-subhead)", fontSize: 13, fontWeight: 700, color: "#392a22", margin: "0 0 8px" }}>
          {savedCount} stories currently in the archive
        </p>
      )}
      <p style={{ color: "#392a22", margin: "0 0 24px" }}>
        Pulls every story from the Wayback Machine snapshot of gangrey.com and imports it into the
        site&apos;s Archive. Runs in batches — keep this tab open until it finishes. Auto-retries on
        errors. Run the steps in order.
      </p>

      <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #b8b8ba" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>Step 1 — Build the date map</h2>
        <p style={{ fontSize: 13, color: "#392a22", margin: "0 0 12px" }}>
          Harvests exact publication dates from Gangrey&apos;s archived RSS feeds (hundreds of Wayback
          snapshots, 2005&ndash;2016). Run this <strong>before importing</strong> — without it, stories
          get stamped with the Wayback capture date instead of their true publication date.
        </p>
        <button onClick={buildMap} disabled={buildingMap || running} style={{ ...btnStyle(false), fontSize: 14 }}>
          {buildingMap ? "Building date map…" : "Build date map"}
        </button>
        {mapResult && <p style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>{mapResult}</p>}
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>Step 2 — Import</h2>
      <p style={{ fontSize: 13, color: "#392a22", margin: "0 0 12px" }}>
        Do a test run first and spot-check bylines and dates in the log, then run the real import.
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => run(0)} disabled={running} style={btnStyle(true)}>
          {running ? "Importing…" : dry ? "Test run (no writes)" : "Start import"}
        </button>
        {hasRun && resumeOffset !== null && !running && !done && (
          <button onClick={() => run(resumeOffset)} style={btnStyle(false)}>
            Resume from {resumeOffset}
          </button>
        )}
        {running && (
          <button onClick={() => { stopRef.current = true; }} style={btnStyle(false)}>
            Stop
          </button>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#392a22" }}>
          <input type="checkbox" checked={dry} disabled={running} onChange={e => setDry(e.target.checked)} />
          Test run (parse only, don't save)
        </label>
      </div>

      {total > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ height: 10, background: "#b8b8ba", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: done ? "#392a22" : "#490000", transition: "width .3s" }} />
          </div>
          <div style={{ fontSize: 13, color: "#392a22", marginTop: 6 }}>
            {processed} / {total} processed · {written} imported {done ? "· done ✅" : ""}
          </div>
        </div>
      )}

      <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #b8b8ba" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>Diagnostics — probe a feed snapshot (optional)</h2>
        <p style={{ fontSize: 13, color: "#392a22", margin: "0 0 12px" }}>
          Fetches one feed snapshot and shows the raw XML + how many dates were extracted. Use offset 0, 1, 2… to inspect different snapshots.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="number" min={0} value={feedProbeOffset} onChange={e => setFeedProbeOffset(Number(e.target.value))}
            style={{ width: 80, padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, fontSize: 14 }} />
          <button onClick={async () => {
            setProbingFeed(true); setFeedProbeResult(null);
            try {
              const res = await fetch(`/api/admin/import-gangrey?feedprobe=1&offset=${feedProbeOffset}`);
              const d = await res.json();
              if (d.error) { setFeedProbeResult(`❌ ${d.error}`); return; }
              setFeedProbeResult(
                `Capture ${d.offset}/${d.total}: ${d.capture.original}\n` +
                `Items found: ${d.itemCount} · Pairs extracted: ${d.pairsExtracted}\n` +
                `Sample pairs: ${JSON.stringify(d.pairs.slice(0, 5), null, 2)}\n\n` +
                `--- XML head ---\n${d.xmlHead}`
              );
            } catch (e) { setFeedProbeResult(`❌ ${String(e)}`); }
            finally { setProbingFeed(false); }
          }} disabled={probingFeed} style={{ ...btnStyle(false), fontSize: 14 }}>
            {probingFeed ? "Probing…" : "Probe"}
          </button>
        </div>
        {feedProbeResult && (
          <pre style={{ marginTop: 10, fontSize: 11, background: "#0d1117", color: "#c9d1d9", padding: 12, borderRadius: 6, overflowX: "auto", whiteSpace: "pre-wrap", maxHeight: 400, overflowY: "auto" }}>
            {feedProbeResult}
          </pre>
        )}
      </div>

      <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #b8b8ba" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>Step 3 — Clean up duplicates</h2>
        <p style={{ fontSize: 13, color: "#392a22", margin: "0 0 12px" }}>
          After the import, finds stories with the same headline and deletes the lower-quality copy (keeps the one with a byline and a path-based slug).
        </p>
        <button onClick={runDedup} disabled={deduping || running} style={{ ...btnStyle(false), fontSize: 14 }}>
          {deduping ? "Deleting duplicates…" : "Delete duplicates"}
        </button>
        {dedupResult && <p style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>{dedupResult}</p>}
      </div>

      <div style={{ marginTop: 24, background: "#0d1117", color: "#c9d1d9", borderRadius: 8, padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, lineHeight: 1.6, maxHeight: 420, overflowY: "auto", whiteSpace: "pre-wrap" }}>
        {log.length === 0 ? <span style={{ color: "#6e7681" }}>Log will appear here…</span> : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
