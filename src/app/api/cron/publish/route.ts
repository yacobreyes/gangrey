import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { renderNewsletterHtml, type NlCard } from "@/lib/newsletterEmail";
import { isSqliteBackend, sqliteAllPostsAdminLight, sqliteDocsByType, sqliteMutate } from "@/lib/storage/sqlite";
import { deliverNewsletter } from "@/app/admin/newsletterActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Self-hosted (SQLite) scheduled-publish pass: flip due scheduled posts to
// published and send any due scheduled newsletters. Mirrors the Sanity path
// below. Driven by a system cron hitting this endpoint (see SELFHOST.md).
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

  return { published: duePosts.length, newslettersSent, ...(newsletterErrors.length ? { newsletterErrors } : {}) };
}

async function sanityMutate(mutations: unknown[]) {
  const token = process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_WRITE_TOKEN;
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  const res = await fetch(
    `https://${projectId}.api.sanity.io/v2024-01-01/data/mutate/${dataset}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mutations }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sanityQuery(q: string) {
  const token = process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_WRITE_TOKEN;
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  const res = await fetch(
    `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { result } = await res.json();
  return result;
}

// Publishes + emails any scheduled newsletters whose time has passed.
async function sendDueNewsletters(): Promise<number> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NEWSLETTER_FROM;
  const due: { _id: string; subject?: string; preview?: string; intro?: string; author?: string; volume?: string; issue?: string; cards?: NlCard[] }[] =
    (await sanityQuery(`*[_type == "newsletter" && status == "scheduled" && scheduledAt <= now()]{ _id, subject, preview, intro, author, volume, issue, cards }`)) ?? [];
  if (!due.length) return 0;

  const subscribers: { email: string }[] = (await sanityQuery(`*[_type == "subscriber" && status == "active"]{ email }`)) ?? [];
  const emails = subscribers.map(s => s.email).filter(Boolean);

  for (const nl of due) {
    if (apiKey && from && emails.length) {
      const html = renderNewsletterHtml({ subject: nl.subject ?? "", preview: nl.preview ?? "", intro: nl.intro ?? "", author: nl.author ?? "", volume: nl.volume ?? "", issue: nl.issue ?? "", cards: nl.cards ?? [] });
      for (let i = 0; i < emails.length; i += 50) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ from, to: from, bcc: emails.slice(i, i + 50), subject: nl.subject, html }),
        });
      }
    }
    await sanityMutate([{ patch: { id: nl._id, set: { status: "published", sentAt: new Date().toISOString() } } }]);
    await upsertIssueForNewsletter(nl);
  }
  return due.length;
}

function slugify(str: string) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Mirrors a just-published scheduled newsletter onto the public Issues page.
async function upsertIssueForNewsletter(nl: { _id: string; subject?: string; preview?: string; issue?: string }) {
  const issueId = `issue-nl-${nl._id}`;
  const existing = await sanityQuery(`*[_id == "${issueId}"][0]{ number, publishedAt }`);
  let number: number | undefined = existing?.number;
  if (number == null) {
    if (nl.issue && !Number.isNaN(Number(nl.issue))) number = Number(nl.issue);
    else {
      const numbers: number[] = (await sanityQuery(`*[_type == "issue"].number`)) ?? [];
      number = numbers.reduce((m, n) => (typeof n === "number" && n > m ? n : m), 0) + 1;
    }
  }
  const slug = slugify(nl.subject ?? "") || `issue-${number}`;
  await sanityMutate([{
    createOrReplace: {
      _id: issueId,
      _type: "issue",
      newsletterId: nl._id,
      number,
      title: nl.subject ?? "",
      description: nl.preview ?? "",
      publishedAt: existing?.publishedAt ?? new Date().toISOString(),
      slug: { _type: "slug", current: slug },
    },
  }]);
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

  if (isSqliteBackend()) {
    return NextResponse.json(await runSqlite());
  }

  const token = process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_WRITE_TOKEN;
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";

  // Fetch all scheduled posts whose time has passed
  const query = encodeURIComponent(
    `*[_type == "post" && status == "scheduled" && scheduledAt <= now()]{ _id }`
  );
  const res = await fetch(
    `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${query}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { result } = await res.json();

  let published = 0;
  if (result?.length) {
    const mutations = result.map((doc: { _id: string }) => ({
      patch: { id: doc._id, set: { status: "published" } },
    }));
    await sanityMutate(mutations);
    published = result.length;
  }

  const newslettersSent = await sendDueNewsletters();

  return NextResponse.json({ published, newslettersSent });
}
