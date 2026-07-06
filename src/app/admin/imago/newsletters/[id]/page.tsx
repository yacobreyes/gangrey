import { isAuthed } from "@/lib/adminAuth";
import { redirect } from "next/navigation";
import { client } from "@/lib/sanity";
import { isSqliteBackend, sqliteGetDoc, sqliteDocsByType } from "@/lib/storage/sqlite";
import NewsletterEditorClient, { type InitialNewsletter } from "../../../NewsletterEditorClient";
import type { NlVersion } from "../../../newsletterActions";

export const dynamic = "force-dynamic";

const NL_FIELDS = `subject, preview, author, cards, status, scheduledAt, volume, issue, intro, lastEditedBy, lastEditedAt`;

export default async function EditNewsletterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const authed = await isAuthed();
  if (!authed) redirect("/admin/imago");

  const { id } = await params;
  const { new: isNewParam } = await searchParams;
  // ?new=1 (Create new) opens straight into editing; every other entry opens
  // read-only so you can watch the current editor without claiming the lock.
  const isNew = isNewParam === "1";

  // Both queries only need the id, so run them concurrently instead of
  // waiting on the draft fetch before starting the versions fetch.
  const [draft, rawVersions] = isSqliteBackend()
    ? [
        sqliteGetDoc<Record<string, unknown>>(id),
        sqliteDocsByType<{ _id: string; newsletterId: string; createdAt?: string }>("newsletterVersion")
          .filter(v => v.newsletterId === id)
          .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
          .slice(0, 20)
          .map(({ _id, ...rest }) => ({ id: _id, ...rest })),
      ]
    : await Promise.all([
        client.fetch(`*[_id == $id][0]{ ${NL_FIELDS} }`, { id }, { cache: "no-store" }),
        client.fetch(
          `*[_type == "newsletterVersion" && newsletterId == $id] | order(createdAt desc)[0...20]{ "id": _id, createdAt, subject, preview, author, wordCount, cards }`,
          { id },
          { cache: "no-store" }
        ),
      ]);

  const initial: InitialNewsletter = draft
    ? {
        subject: draft.subject ?? "",
        preview: draft.preview ?? "",
        author: draft.author ?? "Yacob Reyes",
        status: draft.status ?? "draft",
        scheduledAt: draft.scheduledAt ? String(draft.scheduledAt).slice(0, 16) : "",
        cards: Array.isArray(draft.cards) ? draft.cards : [],
        volume: draft.volume ?? "",
        issue: draft.issue ?? "",
        intro: draft.intro ?? "",
        lastEditedBy: draft.lastEditedBy ?? "",
        lastEditedAt: draft.lastEditedAt ?? "",
      }
    : null;

  const versions: NlVersion[] = rawVersions ?? [];

  return <NewsletterEditorClient newsletterId={id} initial={initial} initialVersions={versions} isNew={isNew} />;
}
