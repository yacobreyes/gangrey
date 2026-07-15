import { isAuthed } from "@/lib/adminAuth";
import { redirect } from "next/navigation";
import { sqliteGetDoc, sqliteDocsByType } from "@/lib/storage/sqlite";
import NewsletterEditorClient, { type InitialNewsletter } from "../../../NewsletterEditorClient";
import type { NlVersion } from "../../../newsletterActions";

export const dynamic = "force-dynamic";

export default async function EditNewsletterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string; classics?: string }> }) {
  const authed = await isAuthed();
  if (!authed) redirect("/admin/imago");

  const { id } = await params;
  const { new: isNewParam, classics: classicsParam } = await searchParams;
  // ?new=1 (Create new) opens straight into editing; every other entry opens
  // read-only so you can watch the current editor without claiming the lock.
  const isNew = isNewParam === "1";
  // ?classics=1 only matters for a brand-new newsletter — it seeds the editor
  // as a Gangrey Classics issue (archive-only cards). Once a doc exists, its
  // own `classics` field (below) is the source of truth.
  const isNewClassics = isNew && classicsParam === "1";

  // Both queries only need the id, so run them concurrently instead of
  // waiting on the draft fetch before starting the versions fetch.
  const draft = sqliteGetDoc<Partial<NonNullable<InitialNewsletter>>>(id);
  const rawVersions = sqliteDocsByType<{ _id: string; newsletterId: string; createdAt?: string }>("newsletterVersion")
    .filter(v => v.newsletterId === id)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 20)
    .map(({ _id, ...rest }) => ({ id: _id, ...rest })) as NlVersion[];

  const initial: InitialNewsletter = draft
    ? {
        subject: draft.subject ?? "",
        preview: draft.preview ?? "",
        author: draft.author ?? "Yacob Reyes",
        status: draft.status ?? "draft",
        scheduledAt: draft.scheduledAt ? String(draft.scheduledAt) : "",
        scheduledBy: draft.scheduledBy ?? "",
        sentAt: draft.sentAt ? String(draft.sentAt) : "",
        cards: Array.isArray(draft.cards) ? draft.cards : [],
        volume: draft.volume ?? "",
        issue: draft.issue ?? "",
        intro: draft.intro ?? "",
        classics: !!draft.classics,
        lastEditedBy: draft.lastEditedBy ?? "",
        lastEditedAt: draft.lastEditedAt ?? "",
      }
    : null;

  const versions: NlVersion[] = rawVersions ?? [];

  return <NewsletterEditorClient newsletterId={id} initial={initial} initialVersions={versions} isNew={isNew} newIsClassics={isNewClassics} />;
}
