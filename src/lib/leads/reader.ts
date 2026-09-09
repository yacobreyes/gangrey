import Anthropic from "@anthropic-ai/sdk";
import { leadsDb } from "./store";

// The reader: a model reads each new record once and answers the questions
// the keyword rules could never answer reliably — is this a NEW business or
// development, what kind, what is it called, and is it worth a reporter's
// morning? Verdicts are stored on the record (ai_json) and drive the queue.
// Skipped gracefully when no API credentials are configured.

export type Verdict = {
  verdict: "new_business" | "development" | "existing_business_work" | "residential_noise" | "government_or_infrastructure" | "other";
  name: string;          // business or project name if the record reveals one, else ""
  kind: string;          // restaurant, bar, hotel, apartments, condos, retail, office, industrial, medical, school, other
  newsworthy: number;    // 0-10 for a Tampa business/development desk
  headline: string;      // <= 90 chars, plain, no em dashes or curly quotes
  why: string;           // one sentence: why it matters, or why it does not
};

const SYSTEM = `You read public records for a small Tampa, Florida newsroom that covers new businesses, restaurants, and commercial and residential development. Competitors are the Tampa Bay Business Journal and Creative Loafing.

For each record, decide what it is and whether it is news. Rules of thumb:
- new_business: a business that does not yet operate at this address is coming (tenant buildout, new restaurant, new alcohol license for a name not previously at the address, change of use, vacant shell being fitted).
- development: new construction, additions, site plans, rezonings, vacatings, hotel/apartment/condo/mixed-use projects, large demolitions clearing a site.
- existing_business_work: a business already operating here is remodeling, repairing, refreshing, or renewing paperwork. Not news unless something went wrong (stop work order, suspension).
- residential_noise: single-family repairs, pools, fences, roofs, individual home remodels.
- government_or_infrastructure: roads, utilities, public facilities, schools (school construction can still be news).
- newsworthy: 9-10 for a named chain or notable project the competitors would write about; 6-8 for a real new business or sizable project without a name; 3-5 for minor commercial work; 0-2 for noise.
- Name only what the record supports. Never invent a name. If a name appears only as an LLC, use it and say it is an LLC.
- headline: plain English, under 90 characters, no em dashes, no curly quotes. Example: "New 210-room Drury hotel planned on Falkenburg Road".

Respond with ONLY a JSON array, one object per record in the same order, each with keys: id, verdict, name, kind, newsworthy, headline, why.`;

type Row = { uid: string; source: string; record_type: string; description: string; address: string; jurisdiction: string; status: string; occupancy: string; valuation: number | null; sq_ft: number | null; units: number | null; contact: string; created_date: string; raw_json: string };

function recordText(r: Row): string {
  const parts = [
    `id: ${r.uid}`, `source: ${r.source}`, `type: ${r.record_type}`, `status: ${r.status}`,
    `address: ${r.address}${r.jurisdiction ? `, ${r.jurisdiction}` : ""}`, `filed: ${r.created_date || "unknown"}`,
    r.occupancy ? `occupancy/use: ${r.occupancy}` : "", r.valuation ? `valuation: $${Math.round(r.valuation)}` : "",
    r.sq_ft ? `sq ft: ${Math.round(r.sq_ft)}` : "", r.units ? `units: ${Math.round(r.units)}` : "",
    r.contact ? `applicant contact: ${r.contact}` : "", `description: ${r.description.slice(0, 900)}`,
  ].filter(Boolean);
  return parts.join("\n");
}

export function readerAvailable(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// Read up to `limit` unread records that could plausibly matter, newest
// first. Returns how many verdicts were stored.
export async function readUnread(limit = 40): Promise<{ read: number; skipped: boolean; error?: string }> {
  if (!readerAvailable()) return { read: 0, skipped: true };
  const db = leadsDb();
  const rows = db.prepare(`
    SELECT uid, source, record_type, description, address, jurisdiction, status, occupancy, valuation, sq_ft, units, contact, created_date, raw_json
    FROM permits
    WHERE (ai_json IS NULL OR ai_json = '')
      AND (score >= 3 OR source IN ('tampaab', 'hcdev', 'tampaent'))
    ORDER BY first_seen_at DESC LIMIT ?`).all(limit) as Row[];
  if (!rows.length) return { read: 0, skipped: false };

  const client = new Anthropic();
  const batches: Row[][] = [];
  for (let i = 0; i < rows.length; i += 10) batches.push(rows.slice(i, i + 10));

  const save = db.prepare(`UPDATE permits SET ai_json = ? WHERE uid = ?`);
  let read = 0;
  for (const batch of batches) {
    try {
      const response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: batch.map((r, i) => `--- record ${i + 1} ---\n${recordText(r)}`).join("\n\n") }],
      });
      if (response.stop_reason === "refusal") continue;
      const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
      const start = text.indexOf("["), end = text.lastIndexOf("]");
      if (start < 0 || end < 0) continue;
      const verdicts = JSON.parse(text.slice(start, end + 1)) as (Verdict & { id?: string })[];
      const byId = new Map(verdicts.map(v => [String(v.id ?? ""), v]));
      batch.forEach((r, i) => {
        const v = byId.get(r.uid) ?? verdicts[i];
        if (!v) return;
        const clean: Verdict = {
          verdict: v.verdict, name: String(v.name ?? "").slice(0, 120), kind: String(v.kind ?? "").slice(0, 40),
          newsworthy: Math.max(0, Math.min(10, Number(v.newsworthy) || 0)),
          headline: String(v.headline ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').slice(0, 120),
          why: String(v.why ?? "").slice(0, 300),
        };
        save.run(JSON.stringify(clean), r.uid);
        read++;
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return { read, skipped: false, error: "API credentials rejected" };
      if (e instanceof Anthropic.RateLimitError) return { read, skipped: false, error: "rate limited; will resume" };
      return { read, skipped: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { read, skipped: false };
}
