import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/adminAuth";
import {
  cached, fetchDeeds, fetchNws, fetchRss, fetchReddit,
  deedBadges, watchHit, type DeedRow, type FeedItem, type RedditItem, type NwsAlert,
} from "@/lib/trib";
import { NEWS_FEEDS, SUBREDDITS, DEED_DAYS, CACHE_TTL } from "./config";

// Private reporting dashboard, ported from the tampatrib PHP sub-site.
// Gated like the DeLorean, but tighter: only a signed-in Imago ADMIN gets the
// page; everyone else gets a bare 404 with no login form, no name, nothing to
// suggest the route exists. noindex, never in the sitemap or robots.txt.
export const dynamic = "force-dynamic";

// Metadata is gated too: static metadata resolves even for a notFound()
// render and rides along in the RSC payload, so an anonymous 404 would carry
// the string "tampatrib" for anyone reading the page source. Outsiders get
// only a robots tag.
export async function generateMetadata(): Promise<Metadata> {
  const me = await getCurrentUser();
  const admin = !!me && me.role === "admin";
  return {
    ...(admin ? { title: "tampatrib" } : {}),
    robots: { index: false, follow: false },
  };
}

function esc(s: string): string {
  return s; // JSX escapes; helper kept for parity where strings interpolate
}

function SectionErr({ d }: { d: Record<string, unknown> }) {
  if (d._error) return <p className="err">unavailable: {String(d._error)}</p>;
  if (d._stale) return <p className="err stale">showing cached copy (refresh failed: {String(d._stale)})</p>;
  return null;
}

function MarkTitle({ title }: { title: string }) {
  const w = watchHit(title);
  if (!w) return <>{title}</>;
  const idx = title.toLowerCase().indexOf(w.toLowerCase());
  return <>{title.slice(0, idx)}<mark>{title.slice(idx, idx + w.length)}</mark>{title.slice(idx + w.length)}</>;
}

const CSS = `
 :root{--bg:#f8fafc;--fg:#0f172a;--card:#fff;--muted:#64748b;--line:#e2e8f0;--accent:#2563eb}
 @media(prefers-color-scheme:dark){:root{--bg:#0b1120;--fg:#e2e8f0;--card:#101a33;--muted:#8ea0bd;--line:#1e2b4a}}
 *{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:1rem}
 header.trib{display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap;max-width:1200px;margin:0 auto .6rem}
 h1{font-size:1.3rem;margin:0}.muted{color:var(--muted);font-size:.85rem}
 header.trib a{color:var(--muted)}
 #q{margin-left:auto;padding:.4rem .7rem;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);min-width:220px}
 .grid{display:grid;gap:1rem;max-width:1200px;margin:0 auto;grid-template-columns:1fr}
 @media(min-width:900px){.grid{grid-template-columns:1.4fr 1fr}}
 section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.8rem 1rem;min-width:0}
 h2{font-size:.95rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:.1rem 0 .6rem}
 .row{padding:.45rem 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
 .deed .price{font-weight:700;min-width:6.5rem;display:inline-block}
 .badge{display:inline-block;font-size:.72rem;border-radius:4px;padding:.05rem .45rem;margin-left:.35rem;color:#fff;vertical-align:middle}
 .badge.big{background:#065f46}.badge.ent{background:#1d4ed8}.badge.nom{background:#475569}.badge.flag{background:#b45309}
 .alert{background:#b91c1c;color:#fff;border-radius:8px;padding:.5rem .8rem;margin:.3rem auto;max-width:1200px}
 .err{color:#f87171;font-size:.85rem}.stale{color:#fbbf24}
 a{color:inherit}mark{background:#fde047}
 .hid{display:none}
 footer.trib{max-width:1200px;margin:1rem auto;color:var(--muted);font-size:.8rem}
 .login{font:16px system-ui;display:grid;place-items:center;min-height:80vh}
 .login form{display:flex;gap:.5rem}
 .login input{padding:.5rem .7rem;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
 .login button{padding:.5rem 1rem;border-radius:8px;border:0;background:var(--accent);color:#fff;cursor:pointer}
`;

export default async function TribPage({ searchParams }: { searchParams: Promise<{ force?: string }> }) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") notFound();
  const sp = await searchParams;

  const force = sp.force === "1";
  const [deeds, nws, newsEntries, redditEntries] = await Promise.all([
    cached("deeds", fetchDeeds as () => Promise<Record<string, unknown>>, force),
    cached("nws", fetchNws as () => Promise<Record<string, unknown>>, force),
    Promise.all(Object.entries(NEWS_FEEDS).map(async ([name, url]) =>
      [name, await cached(`rss_${name}`, () => fetchRss(url) as Promise<Record<string, unknown>>, force)] as const)),
    Promise.all(SUBREDDITS.map(async sub =>
      [sub, await cached(`reddit_${sub}`, () => fetchReddit(sub) as Promise<Record<string, unknown>>, force)] as const)),
  ]);

  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <meta httpEquiv="refresh" content="900" />
      <header className="trib">
        <h1>🕸 tampatrib</h1>
        <span className="muted">{esc(now)} · <a href="/trib?force=1">refresh feeds</a></span>
        <input id="q" placeholder="filter everything… (name, street, LLC)" />
      </header>

      {((nws.items as NwsAlert[]) ?? []).map((a, i) => (
        <div className="alert" key={i}><strong>{a.event}</strong>{" "}
          <span className="muted" style={{ color: "#fecaca" }}>{a.headline}</span></div>
      ))}

      <div className="grid">
        <section id="deeds">
          <h2>Deeds — last {DEED_DAYS} days, Hillsborough Clerk ({((deeds.rows as DeedRow[]) ?? []).length})</h2>
          <SectionErr d={deeds} />
          {((deeds.rows as DeedRow[]) ?? []).map(d => (
            <div className="row deed" key={d.instrument || `${d.date}-${d.from}`}>
              <span className="price">${d.price.toLocaleString("en-US")}</span>
              {deedBadges(d).map(([label, cls]) => <span key={cls + label} className={`badge ${cls}`}>{label}</span>)}
              <div><span className="muted">{d.date}</span>{" "}
                {d.from} <strong>→</strong> {d.to}
                {d.legal ? <span className="muted"> · {d.legal}</span> : null}
                <span className="muted"> · #{d.instrument}</span></div>
            </div>
          ))}
        </section>

        <div style={{ display: "grid", gap: "1rem", minWidth: 0 }}>
          {newsEntries.map(([name, feed]) => (
            <section key={name}>
              <h2>{name}</h2>
              <SectionErr d={feed} />
              {((feed.items as FeedItem[]) ?? []).map((i, k) => (
                <div className="row" key={k}><a href={i.url} target="_blank" rel="noreferrer"><MarkTitle title={i.title} /></a></div>
              ))}
            </section>
          ))}

          {redditEntries.map(([sub, feed]) => (
            <section key={sub}>
              <h2>r/{sub}</h2>
              <SectionErr d={feed} />
              {((feed.items as RedditItem[]) ?? []).map((i, k) => (
                <div className="row" key={k}><a href={i.url} target="_blank" rel="noreferrer">{i.title}</a>{" "}
                  <span className="muted">▲{i.score} · {i.comments} comments</span></div>
              ))}
            </section>
          ))}
        </div>
      </div>

      <footer className="trib">Primary sources only. Deeds: Hillsborough Clerk official records. Alerts: NWS.
        {" "}Feeds cache for {Math.round(CACHE_TTL / 60)} min — page auto-reloads every 15.
        {" "}Edit <code>src/app/trib/config.ts</code> for watchlist, thresholds, feeds.</footer>

      <script dangerouslySetInnerHTML={{ __html: `
document.getElementById('q').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  for (const r of document.querySelectorAll('.row'))
    r.classList.toggle('hid', q && !r.textContent.toLowerCase().includes(q));
});` }} />
    </div>
  );
}
