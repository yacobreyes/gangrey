"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireAdmin } from "@/lib/adminAuth";
import { fullName } from "@/lib/users";
import { renderNewsletterHtml, type NlCard } from "@/lib/newsletterEmail";
import { Resend } from "resend";
import { sqliteGetDoc, sqliteDocsByType, sqliteAllPostsAdminLight, sqliteMutate } from "@/lib/storage/sqlite";

async function mutate(mutations: unknown[]) {
  return sqliteMutate(mutations);
}

// The "View in browser" link points at the public /issues/[slug] page for this
// newsletter. Publishing creates that issue doc at a deterministic id (see
// syncIssueForNewsletter below) with a slug derived from the subject. So the
// link is always shown: it uses the existing issue's slug when published, and
// otherwise the slug the issue WILL have (same slugify(subject)) so a test
// send carries the correct forward-looking link.
async function issueViewUrl(newsletterId: string, subject?: string): Promise<string | undefined> {
  const issueId = `issue-nl-${newsletterId}`;
  const issue = sqliteGetDoc<{ slug?: { current?: string } }>(issueId);
  const slug = issue?.slug?.current || slugify(subject ?? "");
  if (!slug) return undefined;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org").replace(/\/$/, "");
  return `${siteUrl}/issues/${slug}`;
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
// The picker list — LIGHT (no portable-text bodies). With the archive imported,
// shipping every story's body here parsed ~2,500 bodies per open and bloated the
// payload, making the editor slow and sometimes failing the whole fetch (→ "No
// stories"). The body is fetched on demand when a story is actually inserted
// (getNewsletterPostBody).
export async function getPostsForNewsletter(): Promise<NlPickablePost[]> {
  await requireAuth();
  return sqliteAllPostsAdminLight(false)
    .filter(p => p.status !== "trashed")
    .map(p => ({
      id: p._id, slug: p.slug, headline: p.headline, byline: p.byline,
      section: p.section, date: p.date, status: p.status as NlPickablePost["status"],
      body: [] as NlCard["body"],
      image: p.image?.url ? { assetId: p.image.url, url: p.image.url, caption: p.image.caption, alt: p.image.alt } : null,
    }));
}

// "On this day in Gangrey" — archive pieces first published on today's calendar
// day (month + day), across every year, newest first. Powers the Classics
// newsletter's one-tap way to build a dated issue from the archive. Light (no
// bodies); insertPostAsCard fetches the body when a piece is actually pulled in.
export async function getArchiveOnThisDay(monthDay?: string): Promise<NlPickablePost[]> {
  await requireAuth();
  // Default to today in the newsroom's timezone so "this day" matches ET, not
  // the server's UTC (which can be a day ahead late at night).
  const md = monthDay ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York", month: "2-digit", day: "2-digit" });
  const wantMd = md.length === 5 ? md : md.slice(5); // accept "MM-DD" or "YYYY-MM-DD"
  const isArchive = (section?: string) => section === "Archive" || section === "Gangrey Redux";
  const light = (p: { _id: string; slug: string; headline: string; byline?: string; section?: string; date?: string; status?: string; image?: { url?: string; caption?: string; alt?: string } }): NlPickablePost => ({
    id: p._id, slug: p.slug, headline: p.headline, byline: p.byline,
    section: p.section, date: p.date, status: p.status as NlPickablePost["status"],
    body: [] as NlCard["body"],
    image: p.image?.url ? { assetId: p.image.url, url: p.image.url, caption: p.image.caption, alt: p.image.alt } : null,
  });

  return sqliteAllPostsAdminLight(false)
    .filter(p => p.status !== "trashed" && isArchive(p.section) && (p.date ?? "").slice(5, 10) === wantMd)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .map(light);
}

// Fetch just one story's portable-text body, when it's actually inserted as a
// card — keeps the picker list light.
export async function getNewsletterPostBody(slug: string): Promise<NlCard["body"]> {
  await requireAuth();
  const { sqliteGetPost } = await import("@/lib/storage/sqlite");
  return (sqliteGetPost(slug)?.body ?? []) as NlCard["body"];
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
  return sqliteDocsByType<{ _id: string; newsletterId: string; createdAt: string } & Omit<NlVersion, "id">>("newsletterVersion")
    .filter(v => v.newsletterId === newsletterId)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 20)
    .map(({ _id, ...rest }) => ({ id: _id, ...rest })) as NlVersion[];
}

export type NlPayload = {
  id: string;
  subject?: string;
  preview?: string;
  author?: string;
  volume?: string;
  issue?: string;
  intro?: string;
  classics?: boolean;
  wordCount?: number;
  cards?: NlCard[];
  status?: "draft" | "published" | "scheduled";
  scheduledAt?: string;
  copyEditor?: string;
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
  const existing = sqliteGetDoc<{ number?: number; publishedAt?: string }>(issueId);

  let number = existing?.number;
  if (number == null) {
    if (payload.issue && !Number.isNaN(Number(payload.issue))) {
      number = Number(payload.issue);
    } else {
      const numbers: number[] = sqliteDocsByType<{ number?: number }>("issue").map(i => i.number as number);
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

  const existing = sqliteGetDoc<{ createdAt?: string; status?: string }>(id);

  const draftDoc: Record<string, unknown> = {
    _id: id,
    _type: "newsletter",
    subject: payload.subject ?? "",
    preview: payload.preview ?? "",
    author: payload.author ?? "Yacob Reyes",
    volume: payload.volume ?? "",
    issue: payload.issue ?? "",
    intro: payload.intro ?? "",
    classics: payload.classics ?? false,
    wordCount: payload.wordCount ?? 0,
    cards: payload.cards ?? [],
    copyEditor: payload.copyEditor ?? "",
    status: payload.status ?? existing?.status ?? "draft",
    // Who scheduled it — shown in the editor's view-mode banner. Cleared
    // whenever the newsletter isn't scheduled.
    scheduledBy: (payload.status ?? existing?.status) === "scheduled" ? fullName(me) : null,
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
  const latest = (await versionsFor(id))[0] ?? null;
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
    const staleAutosaves: string[] = sqliteDocsByType<{ _id: string; newsletterId: string; type?: string; createdAt?: string }>("newsletterVersion")
      .filter(v => v.newsletterId === id && v.type !== "publish")
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(60).map(v => v._id);
    await mutate([{ createOrReplace: versionDoc }, ...staleAutosaves.map(sid => ({ delete: { id: sid } }))]);
  }

  return { id, versions: await versionsFor(id), syncError };
}

export type Subscriber = { email: string; status?: "active" | "neutral" | "inactive"; createdAt?: string };

function subscriberId(email: string) {
  return "subscriber-" + email.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
}

// Metered-paywall funnel for the current month: how many anonymous readers
// sampled a members-only story, how many hit the wall, plus the free-read
// limit — shown in the Subscribers panel to see the wall's conversion pressure.
export async function getMeterFunnel(): Promise<{ month: string; readers: number; walled: number; limit: number }> {
  await requireAdmin();
  const { sqliteMeterFunnel } = await import("@/lib/storage/sqlite");
  const { meterMonth, METER_LIMIT } = await import("@/lib/meter");
  const month = meterMonth();
  const { readers, walled } = sqliteMeterFunnel(month, METER_LIMIT);
  return { month, readers, walled, limit: METER_LIMIT };
}

export async function getSubscribers(): Promise<Subscriber[]> {
  await requireAdmin();
  return sqliteDocsByType<Subscriber & { _id: string }>("subscriber")
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

// Engagement summary for the Subscribers panel, computed live from the open
// pixel (openedSends on each subscriber) against the published sends. A
// subscriber is judged only on sends that went out after they joined, and
// only once at least 3 of those exist: opening 50%+ of them = active, under
// 50% = inactive. Recomputed here on every load, so it shifts with each send.
export async function getEngagement(): Promise<{
  sends: number; openRate: number | null; active: number; inactive: number; pending: number;
}> {
  await requireAdmin();
  const sends = sqliteDocsByType<{ _id: string; status?: string; sentAt?: string }>("newsletter")
    .filter(n => n.status === "published" && n.sentAt)
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
  const subs = sqliteDocsByType<Subscriber & { openedSends?: string[] }>("subscriber")
    .filter(su => (su.status as string) !== "unsubscribed");
  const last = sends[0]?._id;
  const opened = last ? subs.filter(su => (su.openedSends ?? []).includes(last)).length : 0;
  let active = 0, inactive = 0, pending = 0;
  for (const su of subs) {
    const since = sends.filter(n => !su.createdAt || (n.sentAt ?? "") >= su.createdAt);
    if (since.length < 3) { pending++; continue; }
    const openedCount = since.filter(n => (su.openedSends ?? []).includes(n._id)).length;
    if (openedCount / since.length >= 0.5) active++; else inactive++;
  }
  return {
    sends: sends.length,
    openRate: last && subs.length ? Math.round((opened / subs.length) * 100) : null,
    active, inactive, pending,
  };
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
  const versionIds: string[] = sqliteDocsByType<{ _id: string; newsletterId: string }>("newsletterVersion").filter(v => v.newsletterId === id).map(v => v._id);
  // Cascade to the published issue doc too. Leaving it dangling kept the
  // issue in /issues and the sitemap while /issues/<slug> 404ed (Search
  // Console surfaced exactly that for a deleted newsletter's issue).
  const issueIds: string[] = sqliteDocsByType<{ _id: string; newsletterId?: string }>("issue").filter(i => i.newsletterId === id).map(i => i._id);
  await mutate([{ delete: { id } }, ...versionIds.map(vid => ({ delete: { id: vid } })), ...issueIds.map(iid => ({ delete: { id: iid } }))]);
}

export type SendAudience = "all" | "free" | "members";

// Active paid/comped member emails (lowercased). Used to split the subscriber
// list into free vs paid audiences at send time.
async function activeMemberEmails(): Promise<Set<string>> {
  const rows: { email?: string; status?: string; currentPeriodEnd?: number }[] = sqliteDocsByType<{ email?: string; status?: string; currentPeriodEnd?: number }>("member");
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

  const nl = sqliteGetDoc<{ subject?: string; preview?: string; author?: string; volume?: string; issue?: string; intro?: string; classics?: boolean; cards?: NlCard[] }>(id);
  if (!nl) return { ok: false, error: "Newsletter not found" };
  if (!nl.subject?.trim()) return { ok: false, error: "Add a subject line before sending." };

  // Subscribers are sent to until they unsubscribe — "pending" subscribers
  // haven't opened an email yet and only flip to "active" once they do
  // (tracked via the open pixel below), so they must still receive sends.
  const subscribers: { email: string }[] = sqliteDocsByType<{ email: string }>("subscriber");
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
    classics: nl.classics,
    cards: (nl.cards ?? []) as NlCard[],
    viewOnlineUrl: await issueViewUrl(id, nl.subject),
  });
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.gangrey.org").replace(/\/$/, "");

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

  const nl = sqliteGetDoc<{ subject?: string; preview?: string; author?: string; volume?: string; issue?: string; intro?: string; classics?: boolean; cards?: NlCard[] }>(id);
  if (!nl) return { ok: false, error: "Newsletter not found. Wait for it to save, then try again." };

  try {
    const html = renderNewsletterHtml({
      subject: nl.subject ?? "",
      preview: nl.preview ?? "",
      intro: nl.intro ?? "",
      author: nl.author ?? "",
      volume: nl.volume ?? "",
      issue: nl.issue ?? "",
      classics: nl.classics,
      cards: (nl.cards ?? []) as NlCard[],
      viewOnlineUrl: await issueViewUrl(id, nl.subject),
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
  } catch (e) {
    // Surface the real reason instead of letting the server action throw (which
    // the client only sees as a generic "failed").
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
