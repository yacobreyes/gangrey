import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sqliteAllPostsAdminLight, sqliteDocsByType, sqliteMutate } from "@/lib/storage/sqlite";
import { deliverNewsletter } from "@/app/admin/newsletterActions";
import { notify } from "@/lib/push";
import { maybeCollectLeadsOnServer } from "@/lib/leads/serverCollect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scheduled-publish pass: flip due scheduled posts to published and send any
// due scheduled newsletters. Driven by a system cron hitting this endpoint
// (see SELFHOST.md).
async function runSqlite(): Promise<{ published: number; newslettersSent: number; newsletterErrors?: string[] }> {
  const now = Date.now();

  const duePosts = sqliteAllPostsAdminLight().filter(
    p => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt).getTime() <= now
  );
  if (duePosts.length) {
    sqliteMutate(duePosts.map(p => ({ patch: { id: p._id, set: { status: "published" } } })));
  }

  const dueNewsletters = sqliteDocsByType<{ _id: string; status?: string; scheduledAt?: string }>("newsletter").filter(
    n => n.status === "scheduled" && n.scheduledAt && new Date(n.scheduledAt).getTime() <= now
  );
  let newslettersSent = 0;
  // Surface failures in the response (and thus publish-cron.log) — a silent
  // ok:false left a due newsletter stuck in Scheduled with no trace of why.
  const newsletterErrors: string[] = [];
  for (const nl of dueNewsletters) {
    const r = await deliverNewsletter(nl._id).catch((e): { ok: boolean; error?: string } => ({ ok: false, error: String(e) }));
    if (r.ok) newslettersSent++;
    else newsletterErrors.push(`${nl._id}: ${("error" in r && r.error) || "unknown error"}`);
  }

  // Scheduled work happens while nobody is watching, so report it. A failed
  // send is the one that genuinely needs chasing; successes are worth a quiet
  // confirmation that the thing you scheduled actually went out.
  if (newsletterErrors.length) {
    notify({
      title: "Scheduled send failed",
      body: newsletterErrors[0],
      url: "/admin/imago",
      tag: "cron-error",
    });
  } else if (newslettersSent > 0 || duePosts.length > 0) {
    const parts: string[] = [];
    if (duePosts.length) parts.push(`${duePosts.length} story${duePosts.length === 1 ? "" : "s"} published`);
    if (newslettersSent) parts.push(`${newslettersSent} newsletter${newslettersSent === 1 ? "" : "s"} sent`);
    notify({ title: "Scheduled work ran", body: parts.join(", "), url: "/admin/imago", tag: "cron-ok" });
  }

  return { published: duePosts.length, newslettersSent, ...(newsletterErrors.length ? { newsletterErrors } : {}) };
}

// Constant-time compare so the secret can't be inferred via response-timing
// differences (early-exit on the first mismatched byte otherwise).
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || !safeEqual(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runSqlite();
  // Lead Desk: the county feeds live on Esri's cloud, which this box can
  // reach, so they collect themselves here about once a day. Never lets a
  // feed problem fail the publish pass.
  let leads: string[] = [];
  try { leads = await maybeCollectLeadsOnServer(); } catch (e) { leads = [`leads: ${String(e)}`]; }
  return NextResponse.json({ ...result, ...(leads.length ? { leads } : {}) });
}
