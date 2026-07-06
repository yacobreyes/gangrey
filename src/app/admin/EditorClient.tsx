"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { savePost, deletePost, trashPost, restorePost, uploadImage, unpublishPost, getVersions, updateMediaAsset } from "./actions";
import ScheduleModal from "@/components/ScheduleModal";
import type { PostVersion } from "./actions";
import { tiptapToPortableText, portableTextToTiptap } from "@/lib/tiptapConvert";
import RichBodyEditor from "@/components/RichBodyEditor";
import type { ToolbarHandles } from "@/components/RichBodyEditor";
import ImagePickerModal from "@/components/ImagePickerModal";
import { useEditLock } from "./useEditLock";
import EditLockBanner from "./EditLockBanner";
import { watchLock, type LockHolder } from "./lockActions";
import { straightenQuotes } from "@/lib/straighten";
import type { JSONContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { SanityPost } from "@/lib/sanity";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";
import { portableToLines, relativeTime, dayLabel, colorForName } from "@/lib/editorDiff";
import VersionCompare from "@/components/admin/VersionCompare";

const FONT = "var(--font-inter), sans-serif";

const INPUT: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.9rem", padding: "0.5rem 0.7rem",
  border: `1px solid ${BORDER}`, borderRadius: 4, width: "100%",
  boxSizing: "border-box", color: TEXT_DARK, outline: "none", background: "white",
};
const LABEL: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.75rem", fontWeight: 700,
  color: TEXT_MUTED, letterSpacing: "0.08em", textTransform: "uppercase",
  display: "block", marginBottom: "0.3rem",
};

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Live character count + Google-length guidance for SEO fields. `ideal` is the
// recommended cap (titles ~60, meta descriptions ~160); `min` flags copy that's
// too short to be useful. Turns amber near the limit and crimson past it.
function SeoCount({ value, ideal, min }: { value: string; ideal: number; min?: number }) {
  const len = value.trim().length;
  const over = len > ideal;
  const near = !over && len >= ideal - 10;
  const short = min != null && len > 0 && len < min;
  const color = over ? CRIMSON : near || short ? "#b8860b" : TEXT_MUTED;
  const note = over
    ? `${len - ideal} over — Google will truncate`
    : short
      ? "a little short"
      : `${ideal - len} left`;
  return (
    <p style={{ fontFamily: FONT, fontSize: "0.72rem", color, margin: "0.35rem 0 0", display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
      <span>{note}</span>
      <span>{len}/{ideal}</span>
    </p>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}


const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

type FormState = {
  headline: string; subheadline: string; byline: string; slug: string;
  section: string; date: string; body: JSONContent;
  status: "draft" | "published" | "scheduled";
  access: "free" | "paid";
  seoHeadline: string; socialHeadline: string; socialDescription: string;
  readingTime: string; sortOrder: string;
};

type MediaAsset = { _id: string; url: string; originalFilename?: string; title?: string; description?: string; altText?: string };

export default function EditorClient({ post, defaultByline = "", isNew = false }: { post: SanityPost; defaultByline?: string; isNew?: boolean }) {
  const router = useRouter();

  // Every open starts in read-only view mode so you can watch the current
  // editor type without claiming the lock. Only a brand-new draft created via
  // "Create new" (isNew=true via ?new=1) skips this and opens straight into
  // editing — second tabs and URL pastes always view first.
  const [viewMode, setViewMode] = useState(!isNew);

  // While in view mode, poll the lock without claiming it so we can show who's
  // actively editing without blocking them.
  const [viewLockHolder, setViewLockHolder] = useState<LockHolder | null>(null);
  useEffect(() => {
    if (!viewMode) { setViewLockHolder(null); return; }
    let alive = true;
    const check = () => watchLock(post._id, new Date().toISOString()).then(s => { if (alive) setViewLockHolder(s.holder); }).catch(() => {});
    check();
    const iv = setInterval(check, 4000);
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel("flatplan-locks"); bc.onmessage = () => { if (alive) check(); }; } catch { /* unsupported */ }
    return () => { alive = false; clearInterval(iv); bc?.close(); };
  }, [viewMode, post._id]);

  // Edit lock: only engaged once you're actually editing. Warns (and pauses
  // autosave) if someone else — or you in another tab — holds it. While in view
  // mode we pass null so no lock is claimed.
  const { holder: lockHolder, selfOtherTab, takeOver, release: releaseLockNow, readOnly: locked } = useEditLock(viewMode ? null : post._id);
  // Treat view mode like a lock for write-guards: never autosave while viewing.
  const readOnly = viewMode || locked;
  const lockedRef = useRef(false);
  useEffect(() => { lockedRef.current = readOnly; }, [readOnly]);

  // Warm the dashboard route so exiting is an instant client-side transition
  // instead of a cold full-page load.
  useEffect(() => { router.prefetch("/admin/imago"); }, [router]);

  const [exiting, setExiting] = useState(false);
  // Once an exit is in flight, suppress the pending autosave timer so it can't
  // fire a second save mid-navigation (which kept the editor mounted through the
  // transition and looked like the story "reopening").
  const exitingRef = useRef(false);

  const initialForm: FormState = {
    headline: post.headline ?? "",
    subheadline: post.subheadline ?? "",
    // New drafts auto-fill the byline with whoever opened them; existing posts
    // keep their saved byline.
    byline: post.byline || (post.slug.startsWith("untitled-") ? defaultByline : ""),
    slug: post.slug,
    section: post.section ?? "",
    date: post.date ?? new Date().toISOString().slice(0, 10),
    body: post.body?.length ? portableTextToTiptap(post.body) : EMPTY_DOC,
    status: post.status === "published" || !post.status ? "published" : post.status === "scheduled" ? "scheduled" : "draft",
    access: post.access === "paid" ? "paid" : "free",
    seoHeadline: post.seoHeadline ?? "",
    socialHeadline: post.socialHeadline ?? "",
    socialDescription: post.socialDescription ?? "",
    readingTime: post.readingTime ? String(post.readingTime) : "",
    sortOrder: post.sortOrder != null ? String(post.sortOrder) : "",
  };

  const [form, setForm] = useState<FormState>(initialForm);
  const [lastSaved, setLastSaved] = useState<FormState>(initialForm);
  const [lastSavedImg, setLastSavedImg] = useState({ id: post.image?.asset?._ref ?? "", caption: post.image?.caption ?? "", alt: post.image?.alt ?? "" });
  const [editorTab, setEditorTab] = useState<"content" | "metadata" | "seo" | "versions">("content");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [isPending, startTransition] = useTransition();
  const [showEllipsis, setShowEllipsis] = useState(false);
  const [versionMenu, setVersionMenu] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(post.scheduledAt?.slice(0, 16) ?? "");
  const [versions, setVersions] = useState<PostVersion[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 700);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    fetch("/api/media").then(r => r.json()).then(d => { if (Array.isArray(d)) setPhotoPickerAssets(d); }).catch(() => {});
  }, []);

  // Popup for re-publishing: ask whether to update publish date
  const [showPublishTimeModal, setShowPublishTimeModal] = useState(false);

  const [imageCaption, setImageCaption] = useState(post.image?.caption ?? "");
  const [imageAlt, setImageAlt] = useState(post.image?.alt ?? "");
  const [imagePreview, setImagePreview] = useState(post.image?.url ?? (post.image?.asset ? "existing" : ""));
  const [imageAssetId, setImageAssetId] = useState(post.image?.asset?._ref ?? "");
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [showImageModal, setShowImageModal] = useState(false);
  const [photoPickerAssets, setPhotoPickerAssets] = useState<MediaAsset[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);

  // Live "watch over the shoulder" sync: while in view mode, poll the post
  // every 3s and update the editor with the current editor's typing.
  useEffect(() => {
    if (!viewMode) return;
    let alive = true;
    const sync = async () => {
      try {
        const r = await fetch(`/api/posts-admin?slug=${encodeURIComponent(post.slug)}`, { cache: "no-store" });
        if (!r.ok || !alive) return;
        const list = await r.json() as SanityPost[];
        const fresh = Array.isArray(list) ? list.find(p => p.slug === post.slug) : null;
        if (!fresh || !alive) return;
        const freshBody = fresh.body?.length ? portableTextToTiptap(fresh.body) : EMPTY_DOC;
        setForm(f => ({
          ...f,
          headline: fresh.headline ?? f.headline,
          subheadline: fresh.subheadline ?? f.subheadline,
          byline: fresh.byline ?? f.byline,
          section: fresh.section ?? f.section,
          date: fresh.date ?? f.date,
          body: freshBody,
        }));
        if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(freshBody)) {
          editor.commands.setContent(freshBody);
        }
      } catch { /* transient — retry next tick */ }
    };
    sync();
    const iv = setInterval(sync, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [viewMode, post.slug, editor]);
  const [toolbar, setToolbar] = useState<ToolbarHandles | null>(null);
  const [showBodyImageModal, setShowBodyImageModal] = useState(false);
  const [bodyImageTab, setBodyImageTab] = useState<"library" | "upload">("library");
  const [bodySelectedAsset, setBodySelectedAsset] = useState<MediaAsset | null>(null);
  const [bodyUploadFile, setBodyUploadFile] = useState<File | null>(null);
  const [bodyUploadPreviewUrl, setBodyUploadPreviewUrl] = useState("");
  const [bodyUploadAlt, setBodyUploadAlt] = useState("");
  const [bodyUploadingNew, setBodyUploadingNew] = useState(false);

  const refreshVersions = useCallback(() => {
    getVersions(post.slug).then(v => { if (Array.isArray(v)) setVersions(v); }).catch(() => {});
  }, [post.slug]);

  // Fetch version history only when the Versions tab is opened (not on mount or
  // on every save) so the editor doesn't hit Sanity for history it isn't showing.
  const editorTabRef = useRef(editorTab);
  editorTabRef.current = editorTab;
  useEffect(() => { if (editorTab === "versions") refreshVersions(); }, [editorTab, refreshVersions]);

  function updateForm(patch: Partial<FormState>) { setForm(prev => ({ ...prev, ...patch })); }

  const isDirty = JSON.stringify(form) !== JSON.stringify(lastSaved) ||
    imageAssetId !== lastSavedImg.id || imageCaption !== lastSavedImg.caption || imageAlt !== lastSavedImg.alt;

  const doSave = useCallback((status: "draft" | "published" | "scheduled", updateDate = false, snapshot = false) => {
    // Don't write while another session holds the lock — avoids clobbering.
    if (lockedRef.current) return;
    // Don't start a fresh save once we're navigating away on exit.
    if (exitingRef.current) return;
    setSaveStatus("saving");
    const fd = new FormData();
    const { body, ...rest } = form;
    const saveDate = (status === "published" && updateDate) ? new Date().toISOString().slice(0, 10) : form.date;
    Object.entries({ ...rest, status, date: saveDate }).forEach(([k, v]) => fd.set(k, String(v)));
    fd.set("body", JSON.stringify(tiptapToPortableText(body)));
    fd.set("id", post._id);
    if (imageAssetId) fd.set("imageAssetId", imageAssetId);
    if (imageCaption) fd.set("imageCaption", imageCaption);
    if (imageAlt) fd.set("imageAlt", imageAlt);
    if (status === "scheduled" && scheduledAt) fd.set("scheduledAt", new Date(scheduledAt).toISOString());
    if (snapshot) fd.set("snapshot", "1");
    startTransition(async () => {
      try {
        await savePost(fd);
        // Only refetch the version list when the panel is actually open — avoids
        // an extra Sanity read on every autosave.
        if (editorTabRef.current === "versions") refreshVersions();
        setLastSaved({ ...form, status, date: saveDate });
        setLastSavedImg({ id: imageAssetId, caption: imageCaption, alt: imageAlt });
        setForm(f => ({ ...f, status, date: saveDate }));
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    });
  }, [form, post._id, imageAssetId, imageCaption, imageAlt, scheduledAt, refreshVersions]);

  const revertToDraft = useCallback(async () => {
    if (!confirm("Revert to draft? This will unpublish the story.")) return;
    setSaveStatus("saving");
    try {
      await unpublishPost(post._id);
      setForm(f => ({ ...f, status: "draft" }));
      setLastSaved(s => ({ ...s, status: "draft" }));
      setSaveStatus("saved");
    } catch (err) {
      console.error("revertToDraft failed", err);
      setSaveStatus("unsaved");
      alert("Failed to revert: " + String(err));
    }
  }, [post._id]);

  // From the scheduled view-mode banner: drop the schedule back to a draft and
  // enter edit mode so the story can be changed.
  const unscheduleToEdit = useCallback(() => {
    setViewMode(false);
    setForm(f => ({ ...f, status: "draft" }));
    setLastSaved(s => ({ ...s, status: "draft" }));
    unpublishPost(post._id).catch(() => {});
  }, [post._id]);

  // Schedule the story, then drop straight to the dashboard's Scheduled tab.
  // Mirrors the fast Save & Exit: fire the save in the background and navigate
  // immediately; the dashboard's delayed refresh picks up the persisted doc.
  const scheduleAndExit = useCallback(() => {
    const fd = new FormData();
    const { body, ...rest } = form;
    Object.entries({ ...rest, status: "scheduled" }).forEach(([k, v]) => fd.set(k, String(v)));
    fd.set("body", JSON.stringify(tiptapToPortableText(body)));
    fd.set("id", post._id);
    if (imageAssetId) fd.set("imageAssetId", imageAssetId);
    if (imageCaption) fd.set("imageCaption", imageCaption);
    if (imageAlt) fd.set("imageAlt", imageAlt);
    if (scheduledAt) fd.set("scheduledAt", new Date(scheduledAt).toISOString());
    fd.set("snapshot", "1");
    exitingRef.current = true;
    setExiting(true);
    releaseLockNow();
    savePost(fd).catch(() => {});
    router.push("/admin/imago?tab=scheduled");
  }, [form, post._id, imageAssetId, imageCaption, imageAlt, scheduledAt, releaseLockNow, router]);

  const revertToVersion = useCallback((i: number) => {
    const snap = versions[i];
    if (!snap) return;
    if (!confirm("Restore this version? Your current text will be replaced.")) return;
    const body = snap.body?.length ? portableTextToTiptap(snap.body) : EMPTY_DOC;
    setForm(f => ({ ...f, headline: snap.headline, subheadline: snap.subheadline, body }));
    if (editor) editor.commands.setContent(body);
  }, [versions, editor]);

  const autosaveCount = useRef(0);
  const lastSnapshotAt = useRef(0);

  // Auto-save after 10s of inactivity following a change. Snapshot a version at
  // most once every 20s of continuous editing (plus the server still dedups
  // no-op snapshots) — this keeps a real history without a write on every pause.
  useEffect(() => {
    if (!isDirty || exitingRef.current) return;
    setSaveStatus("unsaved");
    const timer = setTimeout(() => {
      if (exitingRef.current) return;
      autosaveCount.current += 1;
      const now = Date.now();
      const snapshot = now - lastSnapshotAt.current > 20000;
      if (snapshot) lastSnapshotAt.current = now;
      doSave(form.status === "published" ? "published" : "draft", false, snapshot);
    }, 10000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, imageAssetId, imageCaption, imageAlt, doSave]);

  // A brand-new draft only lives in the URL until something persists it. With
  // the byline auto-filled there's nothing "dirty" to trigger autosave, so an
  // untouched draft would never show on the dashboard. Persist a stub once on
  // mount so it appears immediately.
  const stubSavedRef = useRef(false);
  useEffect(() => {
    if (stubSavedRef.current) return;
    if (!post.slug.startsWith("untitled-")) return;
    stubSavedRef.current = true;
    doSave("draft");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setImagePreview(URL.createObjectURL(file)); setUploadingImage(true);
    try {
      const fd = new FormData(); fd.set("file", file);
      const { assetId } = await uploadImage(fd); setImageAssetId(assetId);
    } catch { /* silent */ }
    finally { setUploadingImage(false); }
  }

  function openImageModal() {
    setShowImageModal(true);
  }

  // Shared gate for publishing and scheduling (a scheduled story goes live
  // automatically, so it needs the same required fields). Returns true if OK.
  function validateForPublish(verb: string): boolean {
    if (!form.headline.trim()) { alert(`Add a headline before ${verb}.`); return false; }
    if (!form.section.trim()) { alert(`Choose a section before ${verb}.`); return false; }
    if (!form.byline.trim()) { alert(`Add an author byline before ${verb}.`); return false; }
    if (!imageAssetId && form.section !== "Archive") { alert(`Add a featured image before ${verb}.`); return false; }
    const bodyText = (form.body.content ?? []).flatMap((n: JSONContent) => (n.content ?? []).map((c: JSONContent) => c.text ?? "")).join("").trim();
    if (!bodyText) { alert(`Write something in the body before ${verb}.`); return false; }
    return true;
  }

  function handlePublishClick() {
    // Viewing — flip into edit mode first rather than publishing from view.
    if (readOnly) { setViewMode(false); return; }
    if (!validateForPublish("publishing")) return;
    if (form.status === "published") {
      setShowPublishTimeModal(true);
    } else {
      doSave("published", true, true);
    }
  }

  const statusLabel = saveStatus === "saving" ? "Saving…" : saveStatus === "unsaved" ? "Unsaved" : "Saved";
  const wordCount = (form.body.content ?? []).flatMap((n: JSONContent) => (n.content ?? []).map((c: JSONContent) => c.text ?? "")).join(" ").trim().split(/\s+/).filter(Boolean).length;

  // Single source for the formatting toolbar buttons. Rendered in the top bar
  // on desktop and in a row below the top bar on mobile (matching the newsletter
  // editor) — one fragment, two placements. Hidden in read-only/view mode.
  const toolbarButtons = editor && !readOnly ? (
    <>
      <button type="button" title="Undo" data-tooltip="Undo" className="tb-btn" disabled={!editor.can().undo()} onMouseDown={e => { e.preventDefault(); editor.chain().focus().undo().run(); }}
        style={{ background: "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: editor.can().undo() ? "pointer" : "default", color: TEXT_MUTED, opacity: editor.can().undo() ? 1 : 0.4 }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
      </button>
      <button type="button" title="Redo" data-tooltip="Redo" className="tb-btn" disabled={!editor.can().redo()} onMouseDown={e => { e.preventDefault(); editor.chain().focus().redo().run(); }}
        style={{ background: "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: editor.can().redo() ? "pointer" : "default", color: TEXT_MUTED, opacity: editor.can().redo() ? 1 : 0.4 }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
      </button>
      <div style={{ width: 1, height: 22, background: BORDER, margin: "0 0.3rem", flexShrink: 0 }} />
      {([
        ["B", "Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), { fontWeight: 700 }],
        ["I", "Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), { fontStyle: "italic" }],
      ] as [string, string, boolean, () => void, React.CSSProperties][]).map(([label, title, active, action, style]) => (
        <button key={label} type="button" title={title} data-tooltip={title} className="tb-btn" onMouseDown={e => { e.preventDefault(); action(); }}
          style={{ background: active ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: active ? CRIMSON : TEXT_MUTED, fontFamily: FONT, fontSize: "1.15rem", ...style }}>
          {label}
        </button>
      ))}
      <button type="button" title="Quote" data-tooltip="Quote" className="tb-btn" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }}
        style={{ background: editor.isActive("blockquote") ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: editor.isActive("blockquote") ? CRIMSON : TEXT_MUTED }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
      <button type="button" title="Headline" data-tooltip="Headline" className="tb-btn" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }}
        style={{ background: editor.isActive("heading", { level: 2 }) ? "#ffffff" : "none", border: "none", borderRadius: 4, padding: "0 8px", height: 38, flexShrink: 0, display: "flex", alignItems: "center", cursor: "pointer", color: editor.isActive("heading", { level: 2 }) ? CRIMSON : TEXT_MUTED, fontFamily: FONT, fontSize: "1rem", fontWeight: 700 }}>
        H2
      </button>
      <div style={{ width: 1, height: 22, background: BORDER, margin: "0 0.3rem", flexShrink: 0 }} />
      <button type="button" title="Bullet List" data-tooltip="Bullet List" className="tb-btn" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}
        style={{ background: editor.isActive("bulletList") ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: editor.isActive("bulletList") ? CRIMSON : TEXT_MUTED }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
      <button type="button" title="Number List" data-tooltip="Number List" className="tb-btn" onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}
        style={{ background: editor.isActive("orderedList") ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: editor.isActive("orderedList") ? CRIMSON : TEXT_MUTED }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
      </button>
      <div style={{ width: 1, height: 22, background: BORDER, margin: "0 0.3rem", flexShrink: 0 }} />
      <button type="button" title="Link" data-tooltip="Link" className="tb-btn" onMouseDown={e => { e.preventDefault(); toolbar?.openLink(); }}
        style={{ background: editor.isActive("link") ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: editor.isActive("link") ? CRIMSON : TEXT_MUTED }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </button>
      <button type="button" title="Image" data-tooltip="Image" className="tb-btn" onMouseDown={e => { e.preventDefault(); toolbar?.openImage(); }}
        style={{ background: "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: TEXT_MUTED }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </button>
      <button type="button" title="Embed" data-tooltip="Embed" className="tb-btn" onMouseDown={e => { e.preventDefault(); toolbar?.openEmbed(); }}
        style={{ background: "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: TEXT_MUTED }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      </button>
    </>
  ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "white", fontFamily: FONT }}>
      <EditLockBanner holder={locked ? lockHolder : null} selfOtherTab={selfOtherTab} onTakeOver={takeOver} />
      {viewMode && !locked && (() => {
        const isScheduled = form.status === "scheduled";
        const message = isScheduled
          ? `This story was scheduled${post.scheduledBy ? ` by ${post.scheduledBy}` : ""} for ${formatTime(post.scheduledAt ?? scheduledAt)}.`
          : viewLockHolder
            ? `${viewLockHolder.name} is currently editing this. Do you want to kick them out?`
            : "You’re viewing this story. Do you want to make changes?";
        const action = isScheduled ? "Unschedule to edit" : viewLockHolder ? "Kick them out" : "Start editing";
        const onClick = isScheduled
          ? unscheduleToEdit
          : () => { setViewMode(false); if (viewLockHolder) setTimeout(takeOver, 100); };
        return (
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 400,
            display: "flex", alignItems: "center", justifyContent: "center", gap: "1.25rem",
            background: "#ffffff", borderTop: `1px solid ${BORDER}`,
            boxShadow: "0 -2px 16px rgba(0,0,0,0.08)", padding: "0.85rem 1.25rem",
            fontFamily: FONT, fontSize: "0.9rem", color: TEXT_DARK,
          }}>
            <span>{message}</span>
            <button type="button" onClick={onClick} style={{
              background: CRIMSON, color: "#fff", border: "none", borderRadius: 22,
              padding: "0.5rem 1.25rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap",
            }}>{action}</button>
          </div>
        );
      })()}
      <style>{`
        body { background: white !important; }
        .tb-btn { position: relative; }
        .tb-btn::after {
          content: attr(data-tooltip);
          position: absolute;
          top: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          background: #000000;
          color: #fff;
          font-family: var(--font-inter), sans-serif;
          font-size: 11px;
          font-weight: 500;
          white-space: nowrap;
          padding: 3px 7px;
          border-radius: 4px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.12s;
          z-index: 200;
        }
        .tb-btn:hover::after { opacity: 1; }
      `}</style>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleImageChange} style={{ display: "none" }} />

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "0 1rem" : "0 1.5rem", borderBottom: `1px solid ${BORDER}`, height: 52, boxSizing: "border-box", flexShrink: 0, background: "white" }}>
        <button type="button" disabled={exiting} onClick={() => {
          if (exiting) return;
          exitingRef.current = true;
          setExiting(true);
          // Don't block navigation on the save. The draft is already persisted
          // (stub-saved on open + continuous autosave), and a soft client-side
          // nav doesn't abort an in-flight server action — so we fire one final
          // save in the background and leave immediately. Awaiting it here is
          // what made Save & Exit hang when the request was slow.
          if (!readOnly) {
            releaseLockNow();
            if (isDirty) {
              const status = form.status === "published" ? "published" : "draft";
              const fd = new FormData();
              const { body, ...rest } = form;
              Object.entries({ ...rest, status }).forEach(([k, v]) => fd.set(k, String(v)));
              fd.set("body", JSON.stringify(tiptapToPortableText(body)));
              fd.set("id", post._id);
              if (imageAssetId) fd.set("imageAssetId", imageAssetId);
              if (imageCaption) fd.set("imageCaption", imageCaption);
              if (imageAlt) fd.set("imageAlt", imageAlt);
              savePost(fd).catch(() => {});
            }
          }
          router.push("/admin/imago");
        }} style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "none", border: "none", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, color: TEXT_MUTED, cursor: exiting ? "default" : "pointer", opacity: exiting ? 0.55 : 1, padding: 0, whiteSpace: "nowrap" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          {!isMobile && (exiting ? "Leaving…" : readOnly ? "Go Back" : "Save & Exit")}
        </button>

        {/* Formatting toolbar — desktop: in the top bar (unchanged) */}
        {!isMobile && editorTab === "content" && toolbarButtons && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>{toolbarButtons}</div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED }}>{readOnly ? "Read only" : statusLabel}</span>
          <button
            type="button"
            disabled={readOnly || isPending || uploadingImage}
            onClick={handlePublishClick}
            style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.35rem 1.1rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: readOnly ? "default" : "pointer", opacity: readOnly ? 0.5 : 1 }}
          >
            {form.status === "published" ? "Update" : "Publish"}
          </button>
          {/* Ellipsis menu */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setShowEllipsis(v => !v)}
              style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: readOnly ? "default" : "pointer", color: TEXT_MUTED, opacity: readOnly ? 0.5 : 1 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
            </button>
            {showEllipsis && (
              <div style={{ position: "absolute", top: "calc(100% + 0.4rem)", right: 0, zIndex: 100, background: "white", border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 180, overflow: "hidden" }} onClick={() => setShowEllipsis(false)}>
                <button type="button" onClick={() => { setShowEllipsis(false); doSave(form.status === "published" ? "published" : "draft"); setTimeout(() => window.open(`/stories/${form.slug}/preview`, "_blank"), 800); }} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: TEXT_DARK, cursor: "pointer" }}>Preview</button>
                <button type="button" onClick={() => { setShowEllipsis(false); if (!validateForPublish("scheduling")) return; const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); setScheduledAt(d.toISOString().slice(0, 16)); setShowScheduler(true); }} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: TEXT_DARK, cursor: "pointer" }}>Schedule</button>
                {form.status === "published" && (
                  <button type="button" onClick={() => { setShowEllipsis(false); revertToDraft(); }} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: TEXT_DARK, cursor: "pointer" }}>Unpublish</button>
                )}
                <div style={{ borderTop: `1px solid ${BORDER}` }} />
                {post.status !== "trashed" ? (
                  <button type="button" onClick={() => { if (confirm(`Delete this post? This cannot be undone.`)) { exitingRef.current = true; startTransition(async () => { await deletePost(post._id); router.push("/admin/imago");}); } }} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: CRIMSON, cursor: "pointer" }}>Delete draft</button>
                ) : (
                  <>
                    <button type="button" onClick={() => startTransition(async () => { await restorePost(post._id); router.push("/admin/imago");})} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: TEXT_DARK, cursor: "pointer" }}>Restore</button>
                    <button type="button" onClick={() => { if (confirm("Delete forever?")) { exitingRef.current = true; startTransition(async () => { await deletePost(post._id); router.push("/admin/imago");}); } }} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: CRIMSON, cursor: "pointer" }}>Delete forever</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Publish time modal */}
      {showPublishTimeModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowPublishTimeModal(false)}>
          <div style={{ background: "white", borderRadius: 10, padding: "1.75rem", width: 340, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }} onClick={e => e.stopPropagation()}>
            <p style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", margin: "0 0 0.5rem", color: TEXT_DARK }}>Update publish time?</p>
            <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, margin: "0 0 1.5rem", lineHeight: 1.5 }}>This story was originally published on <strong>{form.date}</strong>. Do you want to update the publish date to today?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <button type="button" onClick={() => { setShowPublishTimeModal(false); doSave("published", true, true); }} style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 8, padding: "0.6rem 1rem", fontFamily: FONT, fontSize: "0.88rem", fontWeight: 600, cursor: "pointer" }}>
                Update to today ({new Date().toISOString().slice(0, 10)})
              </button>
              <button type="button" onClick={() => { setShowPublishTimeModal(false); doSave("published", false, true); }} style={{ background: "white", color: TEXT_DARK, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "0.6rem 1rem", fontFamily: FONT, fontSize: "0.88rem", cursor: "pointer" }}>
                Keep original ({form.date})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule modal */}
      {showScheduler && (
        <ScheduleModal
          value={scheduledAt}
          onChange={setScheduledAt}
          onConfirm={() => { setShowScheduler(false); scheduleAndExit(); }}
          onClose={() => setShowScheduler(false)}
          label="story"
          disabled={isPending}
        />
      )}

      {/* Preview modal */}
      {showPreview && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowPreview(false)}>
          <div style={{ background: "white", borderRadius: 8, maxWidth: 680, width: "90%", padding: "2.5rem", maxHeight: "85vh", overflowY: "auto", position: "relative" }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowPreview(false)} style={{ position: "absolute", top: "1rem", right: "1rem", background: "none", border: "none", fontSize: "1.4rem", cursor: "pointer", color: TEXT_MUTED }}>×</button>
            <p style={{ fontFamily: FONT, fontSize: "0.7rem", fontWeight: 700, color: TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 0.5rem" }}>{form.section}</p>
            <h1 style={{ fontFamily: FONT, fontSize: "1.8rem", color: TEXT_DARK, margin: "0 0 0.5rem", lineHeight: 1.25 }}>{form.headline || <em style={{ color: TEXT_MUTED }}>No headline</em>}</h1>
            {form.subheadline && <p style={{ fontFamily: FONT, fontSize: "1.05rem", color: TEXT_MUTED, margin: "0 0 1rem" }}>{form.subheadline}</p>}
            <hr style={{ border: "none", borderTop: `1px solid ${BORDER}`, margin: "0 0 1.5rem" }} />
            {(form.body.content ?? []).map((node, i) => {
              if (node.type === "heading") {
                const text = (node.content ?? []).map((n: JSONContent) => n.text ?? "").join("");
                const Tag = node.attrs?.level === 2 ? "h2" : "h3";
                return <Tag key={i} style={{ fontFamily: FONT, fontWeight: 700, fontSize: node.attrs?.level === 2 ? "1.3rem" : "1.1rem", color: TEXT_DARK, margin: "1.5rem 0 0.4rem", lineHeight: 1.3 }}>{text}</Tag>;
              }
              if (node.type === "blockquote") {
                const text = (node.content?.[0]?.content ?? []).map((n: JSONContent) => n.text ?? "").join("");
                return <blockquote key={i} style={{ borderLeft: `3px solid ${CRIMSON}`, margin: "1em 0", padding: "0.1em 0 0.1em 1.2em", fontStyle: "italic", color: "#392a22", fontFamily: FONT }}>{text}</blockquote>;
              }
              if (node.type === "bulletList") {
                return <ul key={i} style={{ fontFamily: "'Georgia', serif", fontSize: "1rem", color: TEXT_DARK, lineHeight: 1.75, margin: "0 0 1.2rem", paddingLeft: "1.4em" }}>
                  {(node.content ?? []).map((item, j) => {
                    const text = (item.content?.[0]?.content ?? []).map((n: JSONContent) => n.text ?? "").join("");
                    return <li key={j}>{text}</li>;
                  })}
                </ul>;
              }
              if (node.type === "orderedList") {
                return <ol key={i} style={{ fontFamily: "'Georgia', serif", fontSize: "1rem", color: TEXT_DARK, lineHeight: 1.75, margin: "0 0 1.2rem", paddingLeft: "1.4em" }}>
                  {(node.content ?? []).map((item, j) => {
                    const text = (item.content?.[0]?.content ?? []).map((n: JSONContent) => n.text ?? "").join("");
                    return <li key={j}>{text}</li>;
                  })}
                </ol>;
              }
              const text = (node.content ?? []).map((n: JSONContent) => n.text ?? "").join("");
              return <p key={i} style={{ fontFamily: "'Georgia', serif", fontSize: "1rem", color: TEXT_DARK, lineHeight: 1.75, margin: "0 0 1.2rem" }}>{text}</p>;
            })}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", flexDirection: "column" }} onClick={() => setShowEllipsis(false)}>

        {/* Mobile tab bar */}
        {isMobile && (
          <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}`, background: "white", flexShrink: 0 }}>
            {(["content", "metadata", "seo", "versions"] as const).map(tab => (
              <button key={tab} type="button" onClick={() => setEditorTab(tab)}
                style={{ flex: 1, background: "none", border: "none", borderBottom: `2px solid ${editorTab === tab ? CRIMSON : "transparent"}`, padding: "0.6rem 0", fontFamily: FONT, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: editorTab === tab ? CRIMSON : TEXT_MUTED, cursor: "pointer" }}>
                {tab === "content" ? "Story" : tab === "metadata" ? "Meta" : tab === "seo" ? "SEO" : "History"}
              </button>
            ))}
          </div>
        )}

        {/* Mobile: formatting toolbar row (matches newsletter editor) — only on
            the Story tab, scrolls horizontally on narrow screens */}
        {isMobile && editorTab === "content" && toolbarButtons && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", padding: "0.25rem 0.75rem", borderBottom: `1px solid ${BORDER}`, background: "white", flexShrink: 0, overflowX: "auto", overflowY: "hidden", touchAction: "pan-x", overscrollBehavior: "contain" }}>
            {toolbarButtons}
          </div>
        )}

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left section nav — desktop only */}
        {!isMobile && (
          <div style={{ width: 180, flexShrink: 0, borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ padding: "1.25rem 0 0.5rem" }}>
              <p style={{ fontFamily: FONT, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED, margin: "0 0 0.4rem 1rem", opacity: 0.7 }}>Required</p>
              {(["content", "metadata", "seo"] as const).map(tab => (
                <button key={tab} type="button" onClick={() => setEditorTab(tab)}
                  style={{ display: "block", width: "100%", background: "none", border: "none", borderLeft: `3px solid ${editorTab === tab ? CRIMSON : "transparent"}`, textAlign: "left", padding: "0.5rem 1rem", fontFamily: FONT, fontSize: "0.9rem", fontWeight: editorTab === tab ? 600 : 400, color: editorTab === tab ? CRIMSON : TEXT_DARK, cursor: "pointer" }}>
                  {tab === "content" ? "Story content" : tab === "metadata" ? "Metadata" : "Social & SEO"}
                </button>
              ))}
            </div>
            <div style={{ padding: "1rem 0 0.5rem", borderTop: `1px solid ${BORDER}`, marginTop: "0.75rem" }}>
              <p style={{ fontFamily: FONT, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED, margin: "0 0 0.4rem 1rem", opacity: 0.7 }}>Optional</p>
              <button type="button" onClick={() => setEditorTab("versions")}
                style={{ display: "block", width: "100%", background: "none", border: "none", borderLeft: `3px solid ${editorTab === "versions" ? CRIMSON : "transparent"}`, textAlign: "left", padding: "0.5rem 1rem", fontFamily: FONT, fontSize: "0.9rem", fontWeight: editorTab === "versions" ? 600 : 400, color: editorTab === "versions" ? CRIMSON : TEXT_DARK, cursor: "pointer" }}>
                Previous versions
              </button>
            </div>
          </div>
        )}

        {/* Canvas */}
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "1.5rem 1.25rem" : "3rem 4rem" }}>
          {editorTab === "content" && (
            <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minHeight: isMobile ? "4rem" : "5.5rem" }}>
                <input
                  placeholder="Type your headline"
                  readOnly={readOnly}
                  style={{ fontFamily: FONT, fontSize: isMobile ? "1.5rem" : "2rem", fontWeight: 700, color: TEXT_DARK, border: "none", outline: "none", width: "100%", background: "transparent", lineHeight: 1.2, padding: 0, margin: 0 }}
                  value={form.headline}
                  onChange={e => { const v = straightenQuotes(e.target.value); updateForm({ headline: v, ...(post.slug.startsWith("untitled-") ? { slug: slugify(v) || post.slug } : {}) }); }}
                />
                <input
                  placeholder="Type your subheadline"
                  readOnly={readOnly}
                  style={{ fontFamily: FONT, fontSize: "1.1rem", fontWeight: 400, color: TEXT_MUTED, border: "none", outline: "none", width: "100%", background: "transparent", lineHeight: 1.4, padding: 0, margin: 0 }}
                  value={form.subheadline}
                  onChange={e => updateForm({ subheadline: straightenQuotes(e.target.value) })}
                />
              </div>
              {!imagePreview ? (
                <button type="button" onClick={openImageModal} style={{ fontFamily: FONT, fontSize: "0.85rem", color: CRIMSON, background: "none", border: `1px solid ${CRIMSON}`, borderRadius: 20, padding: "0.4rem 1rem", cursor: "pointer", alignSelf: "flex-start" }}>
                  Add a featured image
                </button>
              ) : (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="" style={{ width: "100%", maxHeight: 320, objectFit: "cover", borderRadius: 6 }} />
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                    <input placeholder="Caption" style={{ ...INPUT, flex: 1, minWidth: 140 }} value={imageCaption} onChange={e => setImageCaption(straightenQuotes(e.target.value))} />
                    <input placeholder="Alt text" style={{ ...INPUT, flex: 1, minWidth: 140 }} value={imageAlt} onChange={e => setImageAlt(straightenQuotes(e.target.value))} />
                    <button type="button" onClick={openImageModal} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.3rem 0.75rem", fontFamily: FONT, fontSize: "0.8rem", cursor: "pointer", color: TEXT_MUTED }}>Change</button>
                    <button type="button" onClick={() => { setImagePreview(""); setImageAssetId(""); }} style={{ background: "none", border: "none", fontFamily: FONT, fontSize: "0.8rem", cursor: "pointer", color: TEXT_MUTED }}>Remove</button>
                  </div>
                </div>
              )}
              <RichBodyEditor editable={!readOnly} initialContent={form.body} onChange={doc => updateForm({ body: doc })} onEditor={setEditor} onToolbar={h => {
                if (!h) { setToolbar(null); return; }
                setToolbar({ ...h, openImage: () => { setBodySelectedAsset(null); setBodyUploadFile(null); setBodyUploadPreviewUrl(""); setBodyUploadAlt(""); setBodyImageTab("library"); setShowBodyImageModal(true); fetch("/api/media").then(r => r.json()).then(d => { if (Array.isArray(d)) setPhotoPickerAssets(d); }).catch(() => {}); } });
              }} />
              {wordCount > 0 && (
                <p style={{ fontFamily: FONT, fontSize: "0.78rem", color: "#aaa", margin: "1rem 0 0", padding: 0 }}>{wordCount} {wordCount === 1 ? "word" : "words"}</p>
              )}
            </div>
          )}

          {editorTab === "metadata" && (
            <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <label style={LABEL}>Section</label>
                <select style={INPUT} value={form.section} onChange={e => updateForm({ section: e.target.value })}>
                  <option value="">— Select a section —</option>
                  <option>Micro-Memoir</option>
                  <option>Narratives</option>
                  <option>Essays</option>
                  <option value="Archive">Archive</option>
                </select>
              </div>
              <div>
                <label style={LABEL}>Access</label>
                {form.section === "Archive" ? (
                  <p style={{ fontFamily: FONT, fontSize: "0.8rem", color: TEXT_MUTED, margin: 0, lineHeight: 1.5 }}>
                    Archive stories are always members-only.
                  </p>
                ) : (
                  <>
                    <select style={INPUT} value={form.access} onChange={e => updateForm({ access: e.target.value as "free" | "paid" })}>
                      <option value="free">Free — anyone can read</option>
                      <option value="paid">Paid — members only</option>
                    </select>
                    <p style={{ fontFamily: FONT, fontSize: "0.72rem", color: TEXT_MUTED, margin: "0.4rem 0 0", lineHeight: 1.5 }}>
                      Paid stories show a preview + join prompt to non-members.
                    </p>
                  </>
                )}
              </div>
              <div><label style={LABEL}>Author</label><input style={INPUT} value={form.byline} onChange={e => updateForm({ byline: straightenQuotes(e.target.value) })} /></div>
              <div>
                <label style={LABEL}>Publish date</label>
                <input type="date" style={INPUT} value={(form.date || "").slice(0, 10)} onChange={e => updateForm({ date: e.target.value })} />
              </div>
              <div>
                <label style={LABEL}>Reading time</label>
                <select style={INPUT} value={form.readingTime} onChange={e => updateForm({ readingTime: e.target.value })}>
                  <option value="">Auto (from word count)</option>
                  {[1, 2, 3, 4, 5].map(m => (
                    <option key={m} value={m}>{m} min</option>
                  ))}
                </select>
              </div>
              {form.section === "Archive" && (
                <div>
                  <label style={LABEL}>Sort order <span style={{ fontWeight: 400, color: TEXT_MUTED }}>(lower = earlier on same day)</span></label>
                  <input type="number" style={INPUT} value={form.sortOrder} onChange={e => updateForm({ sortOrder: e.target.value })} placeholder="e.g. 1, 2, 3…" />
                </div>
              )}
            </div>
          )}

          {editorTab === "seo" && (
            <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <label style={LABEL}>URL Slug</label>
                <input style={INPUT} value={form.slug.startsWith("untitled-") && !form.headline ? "" : form.slug} onChange={e => updateForm({ slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} placeholder="auto-generated from headline" />
              </div>
              <div>
                <label style={LABEL}>SEO Headline</label>
                <input style={INPUT} value={form.seoHeadline} onChange={e => updateForm({ seoHeadline: e.target.value })} placeholder={form.headline || "Appears in Google search results"} />
                <SeoCount value={form.seoHeadline || form.headline} ideal={60} min={30} />
              </div>
              <div>
                <label style={LABEL}>Social Headline</label>
                <input style={INPUT} value={form.socialHeadline} onChange={e => updateForm({ socialHeadline: e.target.value })} placeholder={form.headline || "Appears on shared link preview"} />
                <SeoCount value={form.socialHeadline || form.headline} ideal={70} min={30} />
              </div>
              <div>
                <label style={LABEL}>Social Description</label>
                <textarea style={{ ...INPUT, resize: "vertical", minHeight: 80 }} value={form.socialDescription} onChange={e => updateForm({ socialDescription: e.target.value })} placeholder="Caption that appears under shared link" />
                <SeoCount value={form.socialDescription} ideal={160} min={70} />
              </div>
            </div>
          )}

          {editorTab === "versions" && (
            <div style={{ maxWidth: 480 }}>
              <div style={{ marginBottom: "1.25rem" }}>
                <h2 style={{ fontFamily: FONT, fontSize: "1rem", fontWeight: 700, color: TEXT_DARK, margin: 0 }}>Previous versions</h2>
                {post.lastEditedBy && post.lastEditedAt && (
                  <p style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED, margin: "0.35rem 0 0" }}>
                    Edited by {post.lastEditedBy} · {relativeTime(post.lastEditedAt)}
                  </p>
                )}
              </div>
              {versions.length === 0 ? (
                <p style={{ fontFamily: FONT, fontSize: "0.88rem", color: TEXT_MUTED }}>No saves recorded yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {(() => {
                    let lastDay = "";
                    return versions.map((v, i) => {
                      const day = dayLabel(v.savedAt);
                      const showHeading = day !== lastDay;
                      lastDay = day;
                      const editor = v.editedBy || "Unknown";
                      return (
                        <div key={i}>
                          {showHeading && (
                            <p style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TEXT_MUTED, margin: i === 0 ? "0 0 0.5rem" : "1.25rem 0 0.5rem" }}>
                              {day}
                            </p>
                          )}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0", borderBottom: `1px solid ${BORDER}`, gap: "0.75rem", cursor: "default", userSelect: "none" }}>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, color: TEXT_DARK, margin: 0 }}>{formatTime(v.savedAt)}</p>
                              <p style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, margin: "0.25rem 0 0", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorForName(editor), flexShrink: 0, display: "inline-block" }} />
                                {editor}
                                <span style={{ opacity: 0.6 }}>
                                  · {v.type === "publish" ? "Published" : "Auto-saved"}{v.wordCount ? ` · ${v.wordCount} words` : ""}
                                </span>
                              </p>
                            </div>
                            <div style={{ position: "relative", flexShrink: 0 }}>
                              <button
                                type="button"
                                onClick={() => setVersionMenu(versionMenu === i ? null : i)}
                                style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: TEXT_MUTED }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
                              </button>
                              {versionMenu === i && (
                                <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 50, background: "white", border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 160, overflow: "hidden" }}>
                                  <button
                                    type="button"
                                    onClick={() => { setVersionMenu(null); setCompareVersion(i); }}
                                    style={{ display: "block", width: "100%", background: "none", border: "none", borderBottom: `1px solid ${BORDER}`, textAlign: "left", padding: "0.6rem 1rem", fontFamily: FONT, fontSize: "0.85rem", color: TEXT_DARK, cursor: "pointer" }}
                                  >
                                    Compare changes
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setVersionMenu(null); revertToVersion(i); }}
                                    style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.6rem 1rem", fontFamily: FONT, fontSize: "0.85rem", color: TEXT_DARK, cursor: "pointer" }}
                                  >
                                    Restore this version
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Version compare — Google-Docs-style inline redline */}
      {compareVersion !== null && versions[compareVersion] && (
        <VersionCompare
          label={formatTime(versions[compareVersion].savedAt)}
          oldLines={[versions[compareVersion].headline, versions[compareVersion].subheadline, ...portableToLines(versions[compareVersion].body)].map(s => (s ?? "").trim()).filter(Boolean)}
          newLines={[form.headline, form.subheadline, ...portableToLines(tiptapToPortableText(form.body))].map(s => s.trim()).filter(Boolean)}
          onRestore={() => { const i = compareVersion; setCompareVersion(null); if (i !== null) revertToVersion(i); }}
          onClose={() => setCompareVersion(null)}
          isMobile={isMobile}
        />
      )}

      {/* Body image modal */}
      {showBodyImageModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowBodyImageModal(false)}>
          <div style={{ background: "white", borderRadius: isMobile ? 0 : 10, width: isMobile ? "100vw" : "min(880px, 95vw)", height: isMobile ? "100dvh" : "min(600px, 90vh)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "1rem 1.5rem", borderBottom: `1px solid ${BORDER}` }}>
              <p style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", margin: "0 0 0.75rem", color: TEXT_DARK }}>Add image</p>
              <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${BORDER}`, marginBottom: -1 }}>
                {(["library", "upload"] as const).map(tab => (
                  <button key={tab} type="button" onClick={() => setBodyImageTab(tab)}
                    style={{ background: "none", border: "none", borderBottom: `2px solid ${bodyImageTab === tab ? CRIMSON : "transparent"}`, marginBottom: -2, padding: "0.4rem 1rem", fontFamily: FONT, fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: bodyImageTab === tab ? CRIMSON : TEXT_MUTED, cursor: "pointer" }}>
                    {tab === "library" ? "Library" : "Upload new"}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
              {bodyImageTab === "library" && (
                <>
                  <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
                    {photoPickerAssets.length === 0 ? (
                      <p style={{ fontFamily: FONT, color: TEXT_MUTED }}>No images in library yet.</p>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.5rem" }}>
                        {photoPickerAssets.map(a => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={a._id} src={a.url} alt={a.originalFilename}
                            onClick={() => { setBodySelectedAsset(a); setBodyUploadAlt(a.altText ?? ""); }}
                            style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 4, cursor: "pointer", border: `2px solid ${bodySelectedAsset?._id === a._id ? CRIMSON : "transparent"}`, boxSizing: "border-box" }} />
                        ))}
                      </div>
                    )}
                  </div>
                  {bodySelectedAsset && (
                    <div style={{ width: 260, flexShrink: 0, borderLeft: `1px solid ${BORDER}`, padding: "1rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={bodySelectedAsset.url} alt="" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 6 }} />
                      <div><label style={LABEL}>Alt text</label><input style={INPUT} value={bodyUploadAlt} onChange={e => setBodyUploadAlt(straightenQuotes(e.target.value))} placeholder="Describe this image…" /></div>
                    </div>
                  )}
                </>
              )}
              {bodyImageTab === "upload" && (
                <div style={{ flex: 1, display: "flex", gap: "1.5rem", padding: "1.5rem", overflowY: "auto" }}>
                  <div style={{ flex: 1 }}>
                    {!bodyUploadPreviewUrl ? (
                      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: `2px dashed ${BORDER}`, borderRadius: 8, padding: "2.5rem 1rem", cursor: "pointer", textAlign: "center" }}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={TEXT_MUTED} strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: "0.75rem" }}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        <p style={{ fontFamily: FONT, fontSize: "0.9rem", color: TEXT_DARK, margin: "0 0 0.25rem", fontWeight: 600 }}>Drag image here or <span style={{ color: CRIMSON }}>click to upload</span></p>
                        <p style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED, margin: 0 }}>JPEG, PNG, GIF, or WEBP</p>
                        <input type="file" accept="image/*" onChange={async e => {
                          const file = e.target.files?.[0]; if (!file) return;
                          setBodyUploadFile(file); setBodyUploadPreviewUrl(URL.createObjectURL(file));
                        }} style={{ display: "none" }} />
                      </label>
                    ) : (
                      <div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={bodyUploadPreviewUrl} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 6, marginBottom: "0.5rem" }} />
                        <button type="button" onClick={() => { setBodyUploadFile(null); setBodyUploadPreviewUrl(""); }} style={{ background: "none", border: "none", fontFamily: FONT, fontSize: "0.8rem", color: TEXT_MUTED, cursor: "pointer", padding: 0 }}>Remove</button>
                      </div>
                    )}
                  </div>
                  <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div><label style={LABEL}>Alt text</label><input style={INPUT} value={bodyUploadAlt} onChange={e => setBodyUploadAlt(straightenQuotes(e.target.value))} placeholder="Describe this image…" /></div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", padding: "0.85rem 1.5rem", borderTop: `1px solid ${BORDER}`, background: "#ffffff" }}>
              <button type="button" onClick={() => setShowBodyImageModal(false)} style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.4rem 1.1rem", fontFamily: FONT, fontSize: "0.88rem", cursor: "pointer", color: TEXT_DARK }}>Cancel</button>
              <button type="button"
                disabled={bodyUploadingNew || (bodyImageTab === "library" && !bodySelectedAsset) || (bodyImageTab === "upload" && !bodyUploadFile)}
                style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.4rem 1.1rem", fontFamily: FONT, fontSize: "0.88rem", fontWeight: 600, cursor: "pointer", opacity: (bodyImageTab === "library" && !bodySelectedAsset) || (bodyImageTab === "upload" && !bodyUploadFile) ? 0.5 : 1 }}
                onClick={async () => {
                  if (!editor) return;
                  if (bodyImageTab === "library" && bodySelectedAsset) {
                    editor.chain().focus().setImage({ src: bodySelectedAsset.url, alt: bodyUploadAlt }).run();
                    setShowBodyImageModal(false);
                  } else if (bodyImageTab === "upload" && bodyUploadFile) {
                    setBodyUploadingNew(true);
                    try {
                      const fd = new FormData(); fd.set("file", bodyUploadFile);
                      const { assetId } = await uploadImage(fd);
                      if (bodyUploadAlt) await updateMediaAsset(assetId, { altText: bodyUploadAlt });
                      // fetch the URL back
                      const res = await fetch("/api/media"); const assets: MediaAsset[] = await res.json();
                      const uploaded = assets.find(a => a._id === assetId);
                      const src = uploaded?.url ?? bodyUploadPreviewUrl;
                      editor.chain().focus().setImage({ src, alt: bodyUploadAlt }).run();
                      setPhotoPickerAssets(assets);
                    } catch {} finally { setBodyUploadingNew(false); }
                    setShowBodyImageModal(false);
                  }
                }}
              >{bodyUploadingNew ? "Uploading…" : "Insert image"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Featured image modal */}
      {showImageModal && (
        <ImagePickerModal
          isMobile={isMobile}
          onClose={() => setShowImageModal(false)}
          onSelect={img => { setImageAssetId(img.assetId); setImagePreview(img.url); setImageCaption(img.caption); setImageAlt(img.alt); }}
        />
      )}
    </div>
  );
}
