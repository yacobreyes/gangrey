"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireAdmin } from "@/lib/adminAuth";
import { fullName } from "@/lib/users";
import { client, withRetry } from "@/lib/sanity";
import { renderNewsletterHtml, type NlCard } from "@/lib/newsletterEmail";
import { Resend } from "resend";
import { sanityMutate } from "@/lib/sanityWrite";
import { isSqliteBackend, sqliteGetDoc, sqliteDocsByType, sqliteAllPostsAdmin, sqliteMutate } from "@/lib/storage/sqlite";

// Delegates to the shared write helper, which routes to Sanity or the local
// sqlite store depending on STORAGE_BACKEND.
async function mutate(mutations: unknown[]) {
  if (isSqliteBackend()) return sqliteMutate(mutations);
  return sanityMutate(mutations);
}

export type NlPickablePost = {
  id: string;
  slug: string;
  headline: string;
  byline?: string;
  section?: string;
  date?: string;
  status?: "draft" | "published" | "scheduled";
  body?: NlCard["body"];
  image?: { assetId: string; url: string; caption?: string; alt?: string } | null;
};

// Posts available to pull into a newsletter card. Excludes story-only fields
// (subheadline, etc.) — only headline/body/image carry over to the card itself;
// byline/section/date are fetched just to render the picker list richly.
export async function getPostsForNewsletter(): Promise<NlPickablePost[]> {
  await requireAuth();
  if (isSqliteBackend()) {
    return sqliteAllPostsAdmin(false)
      .filter(p => p.status !== "trashed")
      .map(p => ({
        id: p._id, slug: p.slug, headline: p.headline, byline: p.byline,
        section: p.section, date: p.date, status: p.status as NlPickablePost["status"],
        body: p.body as NlCard["body"],
        image: p.image?.url ? { assetId: p.image.url, url: p.image.url, caption: p.image.caption, alt: p.image.alt } : null,
      }));
  }
  return client.fetch(
    `*[_type == "post" && !(_id in path("drafts.**")) && status != "trashed"] | order(_updatedAt desc){
      "id": _id, "slug": slug.current, headline, byline, section, date, status, body,
      image{ "assetId": asset._ref, "url": asset->url,
        "caption": coalesce(caption, asset->description),
        "alt": coalesce(alt, asset->altText) }
    }`,
    {},
    { cache: "no-store" }
  );
}

export type NlVersion = {
  id: string;
  createdAt: string;
  type?: "autosave" | "publish";
  author?: string;
  subject?: string;
  preview?: string;
  wordCount?: number;
  cards?: NlCard[];
  editedBy?: string;
};

async function versionsFor(newsletterId: string): Promise<NlVersion[]> {
  if (isSqliteBackend()) {
    return sqliteDocsByType<{ _id: string; newsletterId: string; createdAt: string } & Omit<NlVersion, "id">>("newsletterVersion")
      .filter(v => v.newsletterId === newsletterId)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, 20)
      .map(({ _id, ...rest }) => ({ id: _id, ...rest })) as NlVersion[];
  }
  const raw: ({ _id: string } & Record<string, unknown>)[] = await client.fetch(
    `*[_type == "newsletterVersion" && newsletterId == $id] | order(createdAt desc)[0...20]{ _id, createdAt, type, subject, preview, author, wordCount, cards, editedBy }`,
    { id: newsletterId },
    { cache: "no-store" }
  );
  return (raw ?? []).map(({ _id, ...rest }) => ({ id: _id, ...rest })) as NlVersion[];
}

export type NlPayload = {
  id: string;
  subject?: string;
  preview?: string;
  author?: string;
  volume?: string;
  issue?: string;
  intro?: string;
  wordCount?: number;
  cards?: NlCard[];
  status?: "draft" | "published" | "scheduled";
  scheduledAt?: string;
};

function slugify(str: string) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Keeps the public Issues page in sync with a newsletter's publish state:
// publishing upserts an `issue` document (so the newsletter is listed and
// readable at /issues/[slug]); unpublishing removes it again.
async function syncIssueForNewsletter(newsletterId: string, payload: NlPayload, status: string) {
  const issueId = `issue-nl-${newsletterId}`;

  if (status !== "published") {
    try { await mutate([{ delete: { id: issueId } }]); } catch {}
    return;
  }

  // Preserve the issue's number and publish date once assigned, so re-publishing
  // an edit doesn't renumber it or reset its date.
  const existing = isSqliteBackend()
    ? sqliteGetDoc<{ number?: number; publishedAt?: string }>(issueId)
    : await client.fetch<{ number?: number; publishedAt?: string } | null>(
        `*[_id == $id][0]{ number, publishedAt }`,
        { id: issueId },
        { cache: "no-store" }
      );

  let number = existing?.number;
  if (number == null) {
    if (payload.issue && !Number.isNaN(Number(payload.issue))) {
      number = Number(payload.issue);
    } else {
      const numbers: number[] = isSqliteBackend()
        ? sqliteDocsByType<{ number?: number }>("issue").map(i => i.number as number)
        : await client.fetch(`*[_type == "issue"].number`, {}, { cache: "no-store" });
      number = (numbers ?? []).reduce((m, n) => (typeof n === "number" && n > m ? n : m), 0) + 1;
    }
  }

  const slug = slugify(payload.subject ?? "") || `issue-${number}`;

  await mutate([{
    createOrReplace: {
      _id: issueId,
      _type: "issue",
      newsletterId,
      number,
      title: payload.subject ?? "",
      description: payload.preview ?? "",
      publishedAt: existing?.publishedAt ?? new Date().toISOString(),
      slug: { _type: "slug", current: slug },
    },
  }]);

  revalidatePath("/issues");
  revalidatePath(`/issues/${slug}`);
}

// Creates or updates a newsletter document, then snapshots a (deduped) version.
export async function saveNewsletter(payload: NlPayload): Promise<{ id: string; versions: NlVersion[]; syncError?: string }> {
  const me = await requireAuth();
  const now = new Date().toISOString();
  const id = payload.id || `newsletter-${Date.now()}`;

  const existing = isSqliteBackend()
    ? sqliteGetDoc<{ createdAt?: string; status?: string }>(id)
    : await client.fetch(
        `*[_id == $id][0]{ createdAt, status }`,
        { id },
        { cache: "no-store" }
      );

  const draftDoc: Record<string, unknown> = {
    _id: id,
    _type: "newsletter",
    subject: payload.subject ?? "",
    preview: payload.preview ?? "",
    author: payload.author ?? "Yacob Reyes",
    volume: payload.volume ?? "",
    issue: payload.issue ?? "",
    intro: payload.intro ?? "",
    wordCount: payload.wordCount ?? 0,
    cards: payload.cards ?? [],
    status: payload.status ?? existing?.status ?? "draft",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastEditedBy: fullName(me),
    lastEditedAt: now,
    ...(payload.scheduledAt ? { scheduledAt: payload.scheduledAt } : {}),
  };
  await mutate([{ createOrReplace: draftDoc }]);

  // Mirror the newsletter onto the public Issues page when published.
  let syncError: string | undefined;
  try { await syncIssueForNewsletter(id, payload, draftDoc.status as string); } catch (e) { syncError = String(e); }

  // Snapshot a version unless nothing changed since the latest.
  const latest = isSqliteBackend()
    ? (await versionsFor(id))[0] ?? null
    : await client.fetch(
        `*[_type == "newsletterVersion" && newsletterId == $id] | order(createdAt desc)[0]{ subject, preview, author, wordCount, cards }`,
        { id },
        { cache: "no-store" }
      );
  const sameAsLast = latest &&
    JSON.stringify({ subject: latest.subject, preview: latest.preview, author: latest.author, wordCount: latest.wordCount, cards: latest.cards }) ===
    JSON.stringify({ subject: payload.subject, preview: payload.preview, author: payload.author, wordCount: payload.wordCount, cards: payload.cards });

  if (!sameAsLast) {
    const versionDoc = {
      _id: `nlv-${id}-${Date.now()}`,
      _type: "newsletterVersion",
      newsletterId: id,
      createdAt: now,
      type: draftDoc.status === "published" ? "publish" : "autosave",
      subject: payload.subject ?? "",
      preview: payload.preview ?? "",
      author: payload.author ?? "Yacob Reyes",
      wordCount: payload.wordCount ?? 0,
      cards: payload.cards ?? [],
      editedBy: fullName(me),
    };
    // Keep every published snapshot; only prune the oldest autosaves past 60.
    const staleAutosaves: string[] = isSqliteBackend()
      ? sqliteDocsByType<{ _id: string; newsletterId: string; type?: string; createdAt?: string }>("newsletterVersion")
          .filter(v => v.newsletterId === id && v.type !== "publish")
          .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
          .slice(60).map(v => v._id)
      : await client.fetch(
          `*[_type == "newsletterVersion" && newsletterId == $id && type != "publish"] | order(createdAt desc)[60...1000]._id`,
          { id },
          { cache: "no-store" }
        );
    await mutate([{ createOrReplace: versionDoc }, ...staleAutosaves.map(sid => ({ delete: { id: sid } }))]);
  }

  return { id, versions: await versionsFor(id), syncError };
}

export type Subscriber = { email: string; status?: "active" | "neutral" | "inactive"; createdAt?: string };

function subscriberId(email: string) {
  return "subscriber-" + email.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
}

// "active" = opened at least REQUIRED of the last LOOKBACK sends.
// "inactive" = opened none of them (despite LOOKBACK sends having gone out).
// "neutral" = everything in between, including brand-new subscribers with
// no sends yet to judge them by.
const OPEN_LOOKBACK = 3;
const OPEN_REQUIRED = 2;
function classifyByOpens(openedCount: number, lookbackCount: number): "active" | "neutral" | "inactive" {
  if (lookbackCount === 0) return "neutral";
  if (openedCount >= OPEN_REQUIRED) return "active";
  if (openedCount >= 1) return "neutral";
  return "inactive";
}

export async function getSubscribers(): Promise<Subscriber[]> {
  await requireAdmin();
  if (isSqliteBackend()) {
    // No open-tracking pixel data on self-hosted yet, so no status reconcile.
    return sqliteDocsByType<Subscriber & { _id: string }>("subscriber")
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }
  await reconcileSubscriberStatuses();
  return withRetry(() => client.fetch(
    `*[_type == "subscriber"] | order(createdAt desc){ email, status, createdAt }`,
    {},
    { cache: "no-store" }
  ));
}

// Recomputes every subscriber's status from their tracked opens, so the
// dashboard always reflects real engagement rather than whatever status got
// set at signup or on a stale prior send.
async function reconcileSubscriberStatuses() {
  const [subs, recentSends]: [{ _id: string; status?: string; openedSends?: string[] }[], string[]] = await Promise.all([
    client.fetch(`*[_type == "subscriber"]{ _id, status, openedSends }`, {}, { cache: "no-store" }),
    client.fetch(`*[_type == "newsletter" && status == "published"] | order(sentAt desc)[0...${OPEN_LOOKBACK}]._id`, {}, { cache: "no-store" }),
  ]);
  const patches = subs
    .map(s => {
      const openedCount = recentSends.filter(sid => (s.openedSends ?? []).includes(sid)).length;
      const status = classifyByOpens(openedCount, recentSends.length);
      return status !== s.status ? { patch: { id: s._id, set: { status } } } : null;
    })
    .filter((p): p is { patch: { id: string; set: { status: "active" | "neutral" | "inactive" } } } => p !== null);
  if (patches.length) await mutate(patches);
}

export async function removeSubscriber(email: string) {
  await requireAdmin();
  await mutate([{ delete: { id: subscriberId(email) } }]);
}

export async function addSubscriber(email: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const normalized = email.trim().toLowerCase();
  if (!normalized || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  try {
    await mutate([{ createIfNotExists: { _id: subscriberId(normalized), _type: "subscriber", email: normalized, status: "neutral", createdAt: new Date().toISOString() } }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to add subscriber." };
  }
}

export async function getNewsletterVersions(id: string): Promise<NlVersion[]> {
  await requireAuth();
  return versionsFor(id);
}

export async function deleteNewsletter(id: string) {
  await requireAuth();
  const versionIds: string[] = isSqliteBackend()
    ? sqliteDocsByType<{ _id: string; newsletterId: string }>("newsletterVersion").filter(v => v.newsletterId === id).map(v => v._id)
    : await client.fetch(
        `*[_type == "newsletterVersion" && newsletterId == $id]._id`,
        { id },
        { cache: "no-store" }
      );
  await mutate([{ delete: { id } }, ...versionIds.map(vid => ({ delete: { id: vid } }))]);
}

export type SendAudience = "all" | "free" | "members";

// Active paid/comped member emails (lowercased). Used to split the subscriber
// list into free vs paid audiences at send time.
async function activeMemberEmails(): Promise<Set<string>> {
  const rows: { email?: string; status?: string; currentPeriodEnd?: number }[] = isSqliteBackend()
    ? sqliteDocsByType<{ email?: string; status?: string; currentPeriodEnd?: number }>("member")
    : await client.fetch(
        `*[_type == "member"]{ email, status, currentPeriodEnd }`,
        {},
        { cache: "no-store" }
      );
  const now = Date.now();
  const set = new Set<string>();
  for (const m of rows ?? []) {
    if (!m.email) continue;
    if (m.status !== "active" && m.status !== "trialing") continue;
    if (m.currentPeriodEnd && m.currentPeriodEnd * 1000 < now) continue;
    set.add(m.email.trim().toLowerCase());
  }
  return set;
}

// Sends a newsletter via Resend. `audience` selects who receives it:
//   "all"     — every subscriber (members are on this list too)
//   "free"    — subscribers who are NOT active paid members
//   "members" — subscribers who ARE active paid members
// Gated on RESEND_API_KEY + NEWSLETTER_FROM — returns a clear error until they're set.
export async function sendNewsletter(id: string, audience: SendAudience = "all"): Promise<{ ok: boolean; sent?: number; failed?: number; error?: string }> {
  await requireAuth();
  return deliverNewsletter(id, audience);
}

// The actual send + status flip, with NO auth check — so the scheduled-publish
// cron (which runs unauthenticated behind CRON_SECRET) can call it directly.
// User-facing sends go through sendNewsletter, which gates on auth first.
export async function deliverNewsletter(id: string, audience: SendAudience = "all"): Promise<{ ok: boolean; sent?: number; failed?: number; error?: string }> {
  // Prefer GANGREY_RESEND_KEY so the Vercel-Resend integration can't overwrite it.
  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  const from = process.env.NEWSLETTER_FROM;
  if (!apiKey || !from) {
    return { ok: false, error: "Email sending isn't configured yet. Add GANGREY_RESEND_KEY and NEWSLETTER_FROM in Vercel env vars." };
  }
  if (!id) return { ok: false, error: "missing id" };

  const nl = isSqliteBackend()
    ? sqliteGetDoc<{ subject?: string; preview?: string; author?: string; volume?: string; issue?: string; intro?: string; cards?: NlCard[] }>(id)
    : await client.fetch(
        `*[_id == $id][0]{ subject, preview, author, volume, issue, intro, cards }`,
        { id },
        { cache: "no-store" }
      );
  if (!nl) return { ok: false, error: "Newsletter not found" };
  if (!nl.subject?.trim()) return { ok: false, error: "Add a subject line before sending." };

  // Subscribers are sent to until they unsubscribe — "pending" subscribers
  // haven't opened an email yet and only flip to "active" once they do
  // (tracked via the open pixel below), so they must still receive sends.
  const subscribers: { email: string }[] = isSqliteBackend()
    ? sqliteDocsByType<{ email: string }>("subscriber")
    : await client.fetch(
        `*[_type == "subscriber"]{ email }`,
        {},
        { cache: "no-store" }
      );
  if (!subscribers.length) return { ok: false, error: "No subscribers to send to yet." };

  // Split the subscriber list into free vs paid using the current member list.
  const subEmails = Array.from(new Set(subscribers.map(s => s.email).filter(Boolean).map(e => e.toLowerCase())));
  let recipients = subEmails;
  if (audience !== "all") {
    const members = await activeMemberEmails();
    recipients = audience === "members"
      ? subEmails.filter(e => members.has(e))
      : subEmails.filter(e => !members.has(e));
  }
  if (!recipients.length) {
    return { ok: false, error: audience === "members" ? "No paid members on the list yet." : "No recipients in that audience." };
  }

  const baseHtml = renderNewsletterHtml({
    subject: nl.subject,
    preview: nl.preview ?? "",
    intro: nl.intro ?? "",
    author: nl.author ?? "",
    volume: nl.volume ?? "",
    issue: nl.issue ?? "",
    cards: (nl.cards ?? []) as NlCard[],
  });
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gangrey.org").replace(/\/$/, "");

  const resend = new Resend(apiKey);

  const emails = recipients;
  let sent = 0;
  const errors: string[] = [];

  for (const email of emails) {
    const html = `${baseHtml}<img src="${siteUrl}/api/track-open?id=${encodeURIComponent(subscriberId(email))}&nid=${encodeURIComponent(id)}" width="1" height="1" alt="" style="display:none" />`;
    const { error } = await resend.emails.send({ from, to: [email], subject: nl.subject, html });
    if (error) errors.push(`${email}: ${error.message}`);
    else sent++;
  }

  if (errors.length && sent === 0) return { ok: false, error: `Send failed: ${errors[0]}` };
  // Mark as published/sent so the dashboard reflects it.
  try {
    await mutate([{ patch: { id, set: { status: "published", sentAt: new Date().toISOString() } } }]);
  } catch {}
  return { ok: true, sent, failed: emails.length - sent };
}

// Send a single preview copy to the editor so the rendered email can be checked
// in a real inbox before blasting the list. Does not touch subscribers, the
// open-tracking pixel, or the newsletter's status.
const TEST_RECIPIENT = "yacob@gangrey.org";

export async function sendTestNewsletter(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const apiKey = process.env.GANGREY_RESEND_KEY ?? process.env.RESEND_API_KEY;
  const from = process.env.NEWSLETTER_FROM;
  if (!apiKey || !from) {
    return { ok: false, error: "Email sending isn't configured yet. Add GANGREY_RESEND_KEY and NEWSLETTER_FROM in Vercel env vars." };
  }
  if (!id) return { ok: false, error: "missing id" };

  const nl = isSqliteBackend()
    ? sqliteGetDoc<{ subject?: string; preview?: string; author?: string; volume?: string; issue?: string; intro?: string; cards?: NlCard[] }>(id)
    : await client.fetch(
        `*[_id == $id][0]{ subject, preview, author, volume, issue, intro, cards }`,
        { id },
        { cache: "no-store" }
      );
  if (!nl) return { ok: false, error: "Newsletter not found" };

  const html = renderNewsletterHtml({
    subject: nl.subject ?? "",
    preview: nl.preview ?? "",
    intro: nl.intro ?? "",
    author: nl.author ?? "",
    volume: nl.volume ?? "",
    issue: nl.issue ?? "",
    cards: (nl.cards ?? []) as NlCard[],
  });

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [TEST_RECIPIENT],
    subject: `[TEST] ${nl.subject || "Untitled newsletter"}`,
    html,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
