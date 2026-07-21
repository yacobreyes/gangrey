"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { tiptapToPortableText, portableTextToTiptap } from "@/lib/tiptapConvert";
import RichBodyEditor, { type ToolbarHandles } from "@/components/RichBodyEditor";
import ImagePickerModal from "@/components/ImagePickerModal";
import { renderNewsletterHtml } from "@/lib/newsletterEmail";
import { straightenQuotes } from "@/lib/straighten";
import { useEditLock } from "./useEditLock";
import EditLockBanner from "./EditLockBanner";
import { watchLock, type LockHolder } from "./lockActions";
import { saveNewsletter, deleteNewsletter, sendNewsletter, sendTestNewsletter, getPostsForNewsletter, getArchiveOnThisDay, getNewsletterPostBody, type NlVersion, type NlPickablePost } from "./newsletterActions";
import { createPostFromNewsletterCard, checkSlugsExist } from "./actions";
import ScheduleModal from "@/components/ScheduleModal";
import type { JSONContent, Editor } from "@tiptap/react";
import type { PortableTextBlock } from "@portabletext/types";
import { CRIMSON, TEXT_DARK, TEXT_MUTED, BORDER } from "@/lib/palette";
import { NL_TORN_CLIP_PATHS, NL_TAPE_ROTATIONS } from "@/lib/newsletterTokens";
import { portableToLines, relativeTime, dayLabel, colorForName } from "@/lib/editorDiff";
import VersionCompare from "@/components/admin/VersionCompare";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
// Site font (Astoria) for the email-canvas byline, so the preview matches the
// site rather than showing the Mac system font.
const CANVAS_BYLINE = "var(--font-subhead), " + FONT;

// Request a downsized derivative for card-preview images so the editor doesn't
// load full-resolution photos (megabytes) at a few hundred px — the cause of
// images blinking/glitching into place. Local media (/media/...) only.
function sized(url: string, w: number): string {
  return url.startsWith("/media/") ? `${url}${url.includes("?") ? "&" : "?"}w=${w}` : url;
}

const INPUT: React.CSSProperties = {
  fontFamily: FONT, fontSize: "0.9rem", padding: "0.5rem 0.7rem",
  border: `1px solid ${BORDER}`, borderRadius: 4, width: "100%",
  boxSizing: "border-box", color: TEXT_DARK, outline: "none", background: "white",
};

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

const AUDIENCE_LABEL: Record<"all" | "free" | "members", string> = {
  all: "recipient",
  free: "free subscriber",
  members: "paid member",
};

function ptPlainText(blocks?: { _type?: string; children?: { text?: string }[] }[]): string {
  if (!blocks?.length) return "";
  return blocks
    .filter(b => b._type === "block")
    .flatMap(b => (b.children ?? []).map(c => c.text ?? ""))
    .join(" ");
}

function formatVersionTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

// datetime-local input value ("YYYY-MM-DDTHH:mm", viewer-local) from a stored
// UTC ISO timestamp. Falls back to a plain slice for legacy naive values.
function isoToLocalInput(v?: string): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(+d)) return v.slice(0, 16);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "Jul 14 at 6:28am ET" — the newsroom's timezone, matching the story editor.
function formatPublishedTime(v?: string) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(+d)) return "";
  const time = d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "").toLowerCase();
  const date = d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  return `${date} at ${time} ET`;
}

// Date only ("Jul 14") — the fallback for newsletters published before we
// recorded a precise send time.
function formatEtDate(v?: string) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(+d)) return "";
  return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
}

function formatScheduledTime(v?: string) {
  if (!v) return "its scheduled time";
  const d = new Date(v);
  if (isNaN(+d)) return "its scheduled time";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatFindContentDate(date?: string) {
  if (!date) return "";
  const d = date.length === 10 ? new Date(`${date}T12:00:00`) : new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type NlImage = { assetId: string; url: string; caption?: string; alt?: string };
type NlEditorCard = { id: string; headline: string; deck?: string; doc: JSONContent; image?: NlImage; cardType?: "narratives" | "essays" | "micro-memoir" | "archive"; byline?: string; sourceSlug?: string; date?: string };
type StoredCard = { headline?: string; deck?: string; body?: PortableTextBlock[]; image?: NlImage | null; cardType?: "narratives" | "essays" | "micro-memoir" | "archive" | "feature" | "standard" | "digest"; byline?: string; sourceSlug?: string; date?: string };

export type InitialNewsletter = {
  subject: string;
  preview: string;
  author: string;
  status: "draft" | "published" | "scheduled";
  scheduledAt: string;
  scheduledBy?: string;
  sentAt?: string;
  cards: StoredCard[];
  volume: string;
  issue: string;
  intro: string;
  classics?: boolean;
  copyEditor?: string;
  lastEditedBy?: string;
  lastEditedAt?: string;
} | null;

const newNlCard = (): NlEditorCard => ({ id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, headline: "", doc: EMPTY_DOC, cardType: "essays" });

function mapStoredCardType(t: StoredCard["cardType"]): "narratives" | "essays" | "micro-memoir" | "archive" {
  if (t === "feature" || t === "narratives") return "narratives";
  if (t === "standard" || t === "essays") return "essays";
  if (t === "digest" || t === "micro-memoir") return "micro-memoir";
  if (t === "archive") return "archive";
  return "essays";
}

function cardsFromStored(cards: StoredCard[], classics = false): NlEditorCard[] {
  if (!cards.length) {
    return classics
      ? [{ ...newNlCard(), cardType: "archive" }]
      : [
          { ...newNlCard(), cardType: "narratives" },
          { ...newNlCard(), cardType: "essays" },
          { ...newNlCard(), cardType: "micro-memoir" },
        ];
  }
  return cards.map(c => ({
    ...newNlCard(),
    headline: c.headline ?? "",
    deck: c.deck || undefined,
    doc: c.body?.length ? portableTextToTiptap(c.body) : EMPTY_DOC,
    image: c.image ?? undefined,
    cardType: mapStoredCardType(c.cardType),
    byline: c.byline || undefined,
    sourceSlug: c.sourceSlug || undefined,
    date: c.date || undefined,
  }));
}

export default function NewsletterEditorClient({
  newsletterId, initial, initialVersions, isNew = false, newIsClassics = false, editors = [],
}: { newsletterId: string; initial: InitialNewsletter; initialVersions: NlVersion[]; isNew?: boolean; newIsClassics?: boolean; editors?: string[] }) {
  const router = useRouter();
  useEffect(() => { router.prefetch("/admin/imago"); }, [router]);
  const [nlExiting, setNlExiting] = useState(false);

  // Every open starts read-only so you can watch the current editor without
  // claiming the lock. Only a brand-new newsletter (isNew via ?new=1) opens
  // straight into editing.
  const [viewMode, setViewMode] = useState(!isNew);

  // While viewing, poll the lock without claiming it so we can show who's
  // editing. Pass null to useEditLock so no lock is grabbed.
  const [viewLockHolder, setViewLockHolder] = useState<LockHolder | null>(null);
  useEffect(() => {
    if (!viewMode) { setViewLockHolder(null); return; }
    let alive = true;
    const check = () => watchLock(newsletterId, new Date().toISOString()).then(s => { if (alive) setViewLockHolder(s.holder); }).catch(() => {});
    check();
    const iv = setInterval(check, 4000);
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel("flatplan-locks"); bc.onmessage = () => { if (alive) check(); }; } catch { /* unsupported */ }
    return () => { alive = false; clearInterval(iv); bc?.close(); };
  }, [viewMode, newsletterId]);

  // Edit lock — pause autosave & warn when someone else (or another tab) is in it.
  const { holder: lockHolder, selfOtherTab, takeOver, release: releaseLockNow, readOnly: nlLocked } = useEditLock(viewMode ? null : newsletterId);
  // View mode counts as read-only for all write guards.
  const nlReadOnly = viewMode || nlLocked;
  const nlLockedRef = useRef(false);
  useEffect(() => { nlLockedRef.current = nlReadOnly; }, [nlReadOnly]);

  const [isMobile, setIsMobile] = useState(false);
  const [todayLabel, setTodayLabel] = useState("");
  const [coverDateLabel, setCoverDateLabel] = useState("");
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 700);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  useEffect(() => {
    setTodayLabel(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }));
    setCoverDateLabel(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
  }, []);
  // Archive clipping running head: show the story's ORIGINAL publish date
  // ("Month D, YYYY"), falling back to today only when a card has no date.
  const fmtCardDate = (iso?: string) => {
    if (!iso) return coverDateLabel;
    const d = new Date(iso);
    return isNaN(+d) ? coverDateLabel : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  };

  const [nlSubject, setNlSubject] = useState(initial?.subject ?? "");
  const [nlPreview, setNlPreview] = useState(initial?.preview ?? "");
  const [nlAuthor, setNlAuthor] = useState(initial?.author ?? "Yacob Reyes");
  const [nlVolume, setNlVolume] = useState(initial?.volume ?? "");
  const [nlIssue, setNlIssue] = useState(initial?.issue ?? "");
  const [nlIntro, setNlIntro] = useState(initial?.intro ?? "");
  const [nlStatus, setNlStatus] = useState<"draft" | "published" | "scheduled">(initial?.status ?? "draft");
  const [nlScheduledAt, setNlScheduledAt] = useState(isoToLocalInput(initial?.scheduledAt));
  // Gangrey Classics issues are archive-only reprints — the card-type picker
  // is locked to Archive for them (see the pill row below). Existing docs
  // carry their own `classics` flag; brand-new ones take it from the
  // "New newsletter" type-picker modal via ?classics=1.
  const [nlClassics] = useState(initial?.classics ?? newIsClassics);
  const [nlCopyEditor, setNlCopyEditor] = useState(initial?.copyEditor ?? "");
  const [nlCards, setNlCards] = useState<NlEditorCard[]>(() => cardsFromStored(initial?.cards ?? [], nlClassics));
  const [nlVersions, setNlVersions] = useState<NlVersion[]>(initialVersions);

  // Live "watch over the shoulder" sync (parity with the story editor): while
  // in view mode, poll the newsletter every 3s and mirror the current editor's
  // changes. Cards only re-map when their stored content actually changes, so
  // the read-only view doesn't remount its editors on every tick.
  const lastSyncSig = useRef(JSON.stringify(initial?.cards ?? []));
  useEffect(() => {
    if (!viewMode) return;
    let alive = true;
    const sync = async () => {
      try {
        const r = await fetch(`/api/newsletter?id=${encodeURIComponent(newsletterId)}`, { cache: "no-store" });
        if (!r.ok || !alive) return;
        const { draft } = await r.json();
        if (!draft || !alive) return;
        setNlSubject(draft.subject ?? "");
        setNlPreview(draft.preview ?? "");
        setNlAuthor(draft.author ?? "Yacob Reyes");
        setNlVolume(draft.volume ?? "");
        setNlIssue(draft.issue ?? "");
        setNlIntro(draft.intro ?? "");
        if (draft.status === "draft" || draft.status === "published" || draft.status === "scheduled") setNlStatus(draft.status);
        const sig = JSON.stringify(draft.cards ?? []);
        if (sig !== lastSyncSig.current) {
          lastSyncSig.current = sig;
          setNlCards(cardsFromStored((draft.cards ?? []) as StoredCard[], nlClassics));
        }
      } catch { /* transient — retry next tick */ }
    };
    sync();
    const iv = setInterval(sync, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [viewMode, newsletterId, nlClassics]);
  const [nlVersionMenu, setNlVersionMenu] = useState<string | null>(null);
  const [nlCompare, setNlCompare] = useState<string | null>(null);
  const [nlSaveStatus, setNlSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [nlSending, setNlSending] = useState(false);
  const [nlAudience, setNlAudience] = useState<"all" | "free" | "members">("all");
  const [nlImgPickerCard, setNlImgPickerCard] = useState<string | null>(null);
  const [showNlEllipsis, setShowNlEllipsis] = useState(false);
  const [showNlScheduler, setShowNlScheduler] = useState(false);
  const [showNlPreview, setShowNlPreview] = useState(false);

  const [showFindContent, setShowFindContent] = useState(false);
  const [findPosts, setFindPosts] = useState<NlPickablePost[]>([]);
  const [findLoading, setFindLoading] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  // "On this day in Gangrey" — Classics-only archive pieces first published on
  // today's calendar day; toggled open below the cover.
  const [showOnThisDay, setShowOnThisDay] = useState(false);
  const [onThisDay, setOnThisDay] = useState<NlPickablePost[]>([]);
  const [onThisDayLoading, setOnThisDayLoading] = useState(false);
  const onThisDayLoaded = useRef(false);
  const [findShowDraftScheduled, setFindShowDraftScheduled] = useState(false);
  const [nlInsertingPost, setNlInsertingPost] = useState<NlPickablePost | null>(null);
  const nlInsertChipRef = useRef<HTMLDivElement | null>(null);
  const nlInsertStartRef = useRef({ x: 0, y: 0 });
  const nlInsertAtRef = useRef(0);

  const nlIntroRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = nlIntroRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [nlIntro]);

  // On mount, verify that any sourceSlug values still exist in Sanity.
  // If a post was deleted, clear sourceSlug so the "Create draft" button reappears.
  useEffect(() => {
    const slugs = nlCards.map(c => c.sourceSlug).filter((s): s is string => !!s);
    if (!slugs.length) return;
    checkSlugsExist(slugs).then(existing => {
      setNlCards(prev => prev.map(c =>
        c.sourceSlug && !existing.includes(c.sourceSlug) ? { ...c, sourceSlug: undefined } : c
      ));
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nlLastSaved = useRef<string>("");
  const nlDeleting = useRef(false);
  const [nlMovingId, setNlMovingId] = useState<string | null>(null);
  const nlMoveChipRef = useRef<HTMLDivElement | null>(null);
  const nlMoveRectRef = useRef<{ left: number; width: number }>({ left: 0, width: 0 });
  const nlMoveStartYRef = useRef(0);
  const nlCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const nlPrevTops = useRef<Record<string, number> | null>(null);
  const nlCardsRef = useRef<NlEditorCard[]>([]);
  nlCardsRef.current = nlCards;

  const [nlActiveEditor, setNlActiveEditor] = useState<Editor | null>(null);
  const [nlActiveToolbar, setNlActiveToolbar] = useState<ToolbarHandles | null>(null);
  const nlEditors = useRef<Record<string, Editor | null>>({});
  const nlToolbars = useRef<Record<string, ToolbarHandles | null>>({});

  // While a card is "picked up", a click anywhere drops it; Escape cancels.
  // The effect runs after the pick-up click has finished bubbling, so the
  // starting click won't immediately drop it.
  useEffect(() => {
    if (!nlMovingId) return;
    if (nlMoveChipRef.current) nlMoveChipRef.current.style.top = `${nlMoveStartYRef.current - 18}px`;
    const drop = () => setNlMovingId(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNlMovingId(null); };
    // Position the floating card via direct DOM writes (not React state) so
    // it tracks the cursor every frame without re-rendering the whole list.
    // Reorder is recomputed from cursor Y on every move (not mouseenter),
    // so cards swap the instant the cursor crosses a neighbor's midpoint —
    // even if that neighbor just slid out from under a stationary cursor.
    let lastTo: number | null = null;
    const onMove = (e: MouseEvent) => {
      const el = nlMoveChipRef.current;
      if (el) el.style.top = `${e.clientY - 18}px`;

      const cards = nlCardsRef.current;
      const from = cards.findIndex(c => c.id === nlMovingId);
      if (from === -1) return;
      let to = 0;
      for (let idx = 0; idx < cards.length; idx++) {
        if (idx === from) continue;
        const cardEl = nlCardRefs.current[cards[idx].id];
        if (!cardEl) continue;
        const rect = cardEl.getBoundingClientRect();
        if (rect.top + rect.height / 2 < e.clientY) to++;
      }
      if (to === from || to === lastTo) return;
      lastTo = to;
      const tops: Record<string, number> = {};
      for (const c of cards) { const ce = nlCardRefs.current[c.id]; if (ce) tops[c.id] = ce.getBoundingClientRect().top; }
      nlPrevTops.current = tops;
      nlMoveCard(from, to);
    };
    window.addEventListener("mouseup", drop);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMove);
    return () => { window.removeEventListener("mouseup", drop); window.removeEventListener("keydown", onKey); window.removeEventListener("mousemove", onMove); };
  }, [nlMovingId]);

  // FLIP-animate the non-moving cards sliding into their new slots whenever
  // the card order changes mid-drag. nlPrevTops is populated right before
  // nlMoveCard runs (see the onMouseEnter handler below).
  useLayoutEffect(() => {
    const prev = nlPrevTops.current;
    if (!prev) return;
    nlPrevTops.current = null;
    for (const card of nlCards) {
      if (card.id === nlMovingId) continue;
      const el = nlCardRefs.current[card.id];
      const before = prev[card.id];
      if (!el || before === undefined) continue;
      const after = el.getBoundingClientRect().top;
      const delta = before - after;
      if (!delta) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 0.15s ease";
        el.style.transform = "";
      });
    }
  }, [nlCards, nlMovingId]);

  // Load pickable posts whenever the "Find content" panel opens.
  useEffect(() => {
    if (!showFindContent) return;
    setFindLoading(true);
    getPostsForNewsletter().then(setFindPosts).catch(() => setFindPosts([])).finally(() => setFindLoading(false));
  }, [showFindContent]);

  // Load "On this day" archive pieces the first time the section is opened.
  useEffect(() => {
    if (!showOnThisDay || onThisDayLoaded.current) return;
    onThisDayLoaded.current = true;
    setOnThisDayLoading(true);
    getArchiveOnThisDay().then(setOnThisDay).catch(() => setOnThisDay([])).finally(() => setOnThisDayLoading(false));
  }, [showOnThisDay]);

  // Press-and-drag a story out of the find-content panel into the card list.
  // Mirrors the card-reorder drag above: a floating chip follows the cursor,
  // and the drop index is recomputed from cursor Y on every move.
  function startInsertPost(e: React.MouseEvent, post: NlPickablePost) {
    e.preventDefault();
    nlInsertStartRef.current = { x: e.clientX, y: e.clientY };
    setShowFindContent(false);
    setNlInsertingPost(post);
  }

  useEffect(() => {
    if (!nlInsertingPost) return;
    if (nlInsertChipRef.current) {
      nlInsertChipRef.current.style.top = `${nlInsertStartRef.current.y - 18}px`;
      nlInsertChipRef.current.style.left = `${nlInsertStartRef.current.x - 18}px`;
    }
    nlInsertAtRef.current = nlCardsRef.current.length;
    const onMove = (e: MouseEvent) => {
      const el = nlInsertChipRef.current;
      if (el) { el.style.top = `${e.clientY - 18}px`; el.style.left = `${e.clientX - 18}px`; }
      const cards = nlCardsRef.current;
      let to = cards.length;
      for (let idx = 0; idx < cards.length; idx++) {
        const cardEl = nlCardRefs.current[cards[idx].id];
        if (!cardEl) continue;
        if (e.clientY < cardEl.getBoundingClientRect().top + cardEl.getBoundingClientRect().height / 2) { to = idx; break; }
      }
      nlInsertAtRef.current = to;
    };
    const onUp = () => { insertPostAsCard(nlInsertingPost, nlInsertAtRef.current); setNlInsertingPost(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNlInsertingPost(null); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nlInsertingPost]);

  // Only headline/body/image carry over — story-only fields like subheadline
  // have no equivalent on a newsletter card, so they're dropped here. The picker
  // list is light (no bodies), so the body is fetched on demand here and filled
  // into the card once it arrives.
  async function insertPostAsCard(post: NlPickablePost, at: number) {
    // Match the card style to the story's section so an Archive story pulls in
    // as an Archive card, an essay as an Essays card, etc.
    const sec = post.section;
    const cardType: NlEditorCard["cardType"] =
      sec === "Archive" ? "archive" : sec === "Micro-Memoir" ? "micro-memoir" : sec === "Essays" ? "essays" : "narratives";
    // The picker list is light (no body). Fetch this one story's body first so
    // the card mounts with the right content — the rich-text editor reads its
    // content on mount and won't pick up a later fill.
    let body = post.body;
    if (!body?.length && post.slug) {
      body = await getNewsletterPostBody(post.slug).catch(() => [] as NlPickablePost["body"]);
    }
    const card: NlEditorCard = {
      ...newNlCard(),
      cardType,
      headline: straightenQuotes(post.headline ?? ""),
      doc: body?.length ? portableTextToTiptap(body) : EMPTY_DOC,
      image: post.image ?? undefined,
      byline: post.byline ? straightenQuotes(post.byline) : undefined,
      // Carry the story's original publish date so the archive clipping's
      // running head shows when the piece actually ran, not today.
      date: post.date || undefined,
      sourceSlug: post.slug || undefined,
    };
    setNlCards(prev => { const next = [...prev]; next.splice(at, 0, card); return next; });
  }

  function nlUpdateCard(id: string, patch: Partial<NlEditorCard>) {
    // Headline/deck/byline are plain inputs (not the rich-text editor, which
    // straightens on its own), so macOS "smart punctuation" would otherwise
    // leave curly quotes in them. Enforce straight quotes here to match the
    // email/house style everywhere.
    const p = { ...patch };
    if (typeof p.headline === "string") p.headline = straightenQuotes(p.headline);
    if (typeof p.deck === "string") p.deck = straightenQuotes(p.deck);
    if (typeof p.byline === "string") p.byline = straightenQuotes(p.byline);
    setNlCards(prev => prev.map(c => c.id === id ? { ...c, ...p } : c));
  }
  function nlAddCardAfter(index: number) {
    setNlCards(prev => { const next = [...prev]; next.splice(index + 1, 0, { ...newNlCard(), ...(nlClassics ? { cardType: "archive" as const } : {}) }); return next; });
  }
  function nlRemoveCard(id: string) {
    setNlCards(prev => prev.length <= 1 ? prev : prev.filter(c => c.id !== id));
    delete nlEditors.current[id];
    delete nlToolbars.current[id];
  }
  const [nlCreatingDraft, setNlCreatingDraft] = useState<string | null>(null);
  // Turn a native newsletter card into a standalone draft post that can be
  // published on the site. Records the new slug on the card and opens the editor.
  async function nlCreateDraftFromCard(card: NlEditorCard) {
    setNlCreatingDraft(card.id);
    try {
      const section = card.cardType === "essays" ? "Essays" : card.cardType === "micro-memoir" ? "Micro-Memoir" : card.cardType === "archive" ? "Archive" : "Narratives";
      const { slug } = await createPostFromNewsletterCard({
        headline: card.headline,
        body: tiptapToPortableText(card.doc),
        byline: card.byline,
        section,
        image: card.image ? { assetId: card.image.assetId, caption: card.image.caption, alt: card.image.alt } : null,
      });
      nlUpdateCard(card.id, { sourceSlug: slug });
      window.open(`/admin/imago/posts/${slug}`, "_blank");
    } catch {
      alert("Couldn't create the draft. Try again.");
    } finally {
      setNlCreatingDraft(null);
    }
  }
  // Byline row for narrative/essay cards. Populated automatically when a story is
  // pulled in (post.byline); native cards start with no byline and show an
  // "+ Add byline" button that reveals the editable field.
  function nlBylineField(card: NlEditorCard, align: "center" | "left") {
    if (card.byline === undefined) {
      return (
        <button type="button" onClick={() => nlUpdateCard(card.id, { byline: "" })}
          style={{ display: "block", margin: align === "center" ? "0 auto 1rem" : "0 0 0.85rem", background: "none", border: "none", padding: 0, fontFamily: FONT, fontSize: "0.75rem", fontWeight: 600, color: CRIMSON, cursor: "pointer", letterSpacing: "0.02em" }}>
          + Add byline
        </button>
      );
    }
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", justifyContent: align === "center" ? "center" : "flex-start", marginBottom: align === "center" ? "1rem" : "0.85rem" }}>
        <span style={{ fontFamily: CANVAS_BYLINE, fontSize: "0.8rem", fontWeight: 700, color: TEXT_DARK, letterSpacing: "0.02em" }}>By</span>
        <input value={card.byline} onChange={e => nlUpdateCard(card.id, { byline: e.target.value })} placeholder="Author name" autoFocus={!card.byline}
          style={{ fontFamily: FONT, fontSize: "0.8rem", fontWeight: 700, color: TEXT_DARK, letterSpacing: "0.02em", border: "none", outline: "none", background: "transparent", padding: 0, textAlign: "left", width: `${card.byline.length > 0 ? card.byline.length + 1 : 11}ch`, boxSizing: "content-box" }} />
        <button type="button" title="Remove byline" onClick={() => nlUpdateCard(card.id, { byline: undefined })}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: TEXT_MUTED, fontSize: "1rem", lineHeight: 1 }}>×</button>
      </div>
    );
  }
  // Footer row for narrative/essay cards: native cards get a button to spin off a
  // publishable draft post; cards linked to a story show a link to open it.
  function nlCardDraftRow(card: NlEditorCard, align: "center" | "left") {
    const justify = align === "center" ? "center" : "flex-start";
    if (card.sourceSlug) {
      return (
        <div style={{ display: "flex", justifyContent: justify, marginTop: "1rem" }}>
          <a href={`/admin/imago/posts/${card.sourceSlug}`} target="_blank" rel="noreferrer"
            style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 600, color: TEXT_MUTED, textDecoration: "none", letterSpacing: "0.02em", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
            Open linked story draft →
          </a>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", justifyContent: justify, marginTop: "1rem" }}>
        <button type="button" disabled={nlCreatingDraft === card.id} onClick={() => nlCreateDraftFromCard(card)}
          style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 600, color: CRIMSON, background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.3rem 0.85rem", cursor: nlCreatingDraft === card.id ? "default" : "pointer", letterSpacing: "0.02em", opacity: nlCreatingDraft === card.id ? 0.6 : 1 }}>
          {nlCreatingDraft === card.id ? "Creating draft…" : "Create publishable story draft →"}
        </button>
      </div>
    );
  }
  function nlMoveCard(from: number, to: number) {
    setNlCards(prev => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  // Build the serializable newsletter payload (card bodies → portable text).
  // Expensive (converts every card's doc), so only call this right before
  // an actual save — not on every render just to check if something changed.
  const nlPayload = useCallback(() => ({
    id: newsletterId,
    status: nlStatus,
    scheduledAt: nlScheduledAt || undefined,
    subject: nlSubject,
    preview: nlPreview,
    author: nlAuthor,
    volume: nlVolume,
    issue: nlIssue,
    intro: nlIntro,
    classics: nlClassics,
    copyEditor: nlCopyEditor,
    wordCount: nlCards.flatMap(card => (card.doc.content ?? []).flatMap((n: JSONContent) => (n.content ?? []).map((c: JSONContent) => c.text ?? ""))).join(" ").trim().split(/\s+/).filter(Boolean).length,
    cards: nlCards.map(card => ({ headline: card.headline, deck: card.deck, body: tiptapToPortableText(card.doc), image: card.image ?? null, cardType: card.cardType, byline: card.byline, sourceSlug: card.sourceSlug, date: card.date })),
  }), [newsletterId, nlStatus, nlScheduledAt, nlSubject, nlPreview, nlAuthor, nlVolume, nlIssue, nlIntro, nlClassics, nlCopyEditor, nlCards]);

  // Cheap dirty-check signature (raw tiptap docs, no portable-text conversion)
  // so typing doesn't re-run the expensive conversion above on every keystroke.
  const nlSignature = useCallback(() => JSON.stringify({
    status: nlStatus, scheduledAt: nlScheduledAt, subject: nlSubject, preview: nlPreview, author: nlAuthor,
    volume: nlVolume, issue: nlIssue, intro: nlIntro, classics: nlClassics, copyEditor: nlCopyEditor,
    cards: nlCards.map(c => ({ headline: c.headline, deck: c.deck, doc: c.doc, image: c.image ?? null, cardType: c.cardType, byline: c.byline, sourceSlug: c.sourceSlug, date: c.date })),
  }), [nlStatus, nlScheduledAt, nlSubject, nlPreview, nlAuthor, nlVolume, nlIssue, nlIntro, nlClassics, nlCards]);

  const nlSave = useCallback(async (payload: ReturnType<typeof nlPayload>, signature?: string) => {
    if (nlDeleting.current || nlLockedRef.current) return;
    setNlSaveStatus("saving");
    try {
      const data = await saveNewsletter(payload);
      if (Array.isArray(data?.versions)) setNlVersions(data.versions);
      nlLastSaved.current = signature ?? JSON.stringify(payload);
      setNlSaveStatus("saved");
      if (data?.syncError) console.error("[Issues sync error]", data.syncError);
    } catch { setNlSaveStatus("unsaved"); }
  }, []);

  // Seed the dedupe baseline so opening an existing newsletter doesn't immediately re-save.
  useEffect(() => {
    nlLastSaved.current = nlSignature();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A brand-new newsletter only lives in the URL until something persists it.
  // The story editor stubs an untitled draft on mount so it shows on the
  // dashboard immediately; mirror that here — otherwise a new newsletter that
  // you open and Save & Exit without tripping autosave never appears.
  const nlStubbed = useRef(false);
  useEffect(() => {
    if (nlStubbed.current || !isNew || nlLockedRef.current) return;
    nlStubbed.current = true;
    const payload = nlPayload();
    nlSave(payload, nlSignature());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save 3s after you stop typing (matches the story editor). Uses the
  // cheap signature to detect changes on every render, and only pays for the
  // expensive portable-text conversion once the debounce fires.
  useEffect(() => {
    const signature = nlSignature();
    if (signature === nlLastSaved.current) return;
    setNlSaveStatus("unsaved");
    const timer = setTimeout(() => { nlSave(nlPayload(), signature); }, 3000);
    return () => clearTimeout(timer);
  }, [nlSignature, nlPayload, nlSave]);

  async function saveAndExit() {
    if (nlExiting) return;
    setNlExiting(true);
    const isDirty = nlSignature() !== nlLastSaved.current;
    // Release the lock in the background, but AWAIT the save so a new/edited draft
    // is persisted before the dashboard re-fetches — otherwise it's missing when
    // we land. The pagehide beacon still backs up the lock release.
    if (!nlLockedRef.current) {
      releaseLockNow();
      if (!nlDeleting.current && isDirty) await saveNewsletter(nlPayload()).catch(() => {});
    }
    router.push("/admin/imago");
  }

  async function publishNewsletter() {
    if (!nlSubject.trim()) { alert("Add a subject line before publishing."); return; }
    const isAlreadyPublished = nlStatus === "published";
    setNlStatus("published");
    const publishPayload = { ...nlPayload(), status: "published" as const };
    const saveResult = await saveNewsletter(publishPayload);
    if (Array.isArray(saveResult?.versions)) setNlVersions(saveResult.versions);
    nlLastSaved.current = JSON.stringify(publishPayload);
    setNlSaveStatus("saved");
    if (saveResult?.syncError) {
      alert(`Newsletter published, but Issues page sync failed:\n\n${saveResult.syncError}`);
    }
    if (isAlreadyPublished) return;
    setNlSending(true);
    try {
      const d = await sendNewsletter(newsletterId, nlAudience);
      if (!d.ok) alert(d.error || "Send failed.");
      else alert(`Sent to ${d.sent} ${AUDIENCE_LABEL[nlAudience]}${d.sent === 1 ? "" : "s"}.${d.failed ? ` ${d.failed} failed.` : ""}`);
    } catch { alert("Send failed."); }
    finally { setNlSending(false); }
  }

  async function unpublishNewsletter() {
    setNlStatus("draft");
    await nlSave({ ...nlPayload(), status: "draft" });
  }

  async function scheduleNewsletter() {
    if (!nlScheduledAt) return;
    setNlStatus("scheduled");
    setShowNlScheduler(false);
    // Match the story editor: fire the save in the background and go straight
    // to the dashboard's Scheduled tab — no lingering in the editor.
    // Store real UTC — the naive datetime-local string would be parsed in the
    // SERVER's timezone by the publish cron and fire hours off.
    nlSave({ ...nlPayload(), status: "scheduled", scheduledAt: new Date(nlScheduledAt).toISOString() }).catch(() => {});
    releaseLockNow();
    router.push("/admin/imago?tab=scheduled");
  }

  // From the scheduled view-mode banner: drop the schedule back to a draft and
  // enter edit mode so the newsletter can be changed.
  function unscheduleNlToEdit() {
    setViewMode(false);
    setNlStatus("draft");
    setNlScheduledAt("");
    nlSave({ ...nlPayload(), status: "draft", scheduledAt: undefined }).catch(() => {});
  }

  async function removeNewsletter() {
    if (!confirm("Delete this newsletter? This cannot be undone.")) return;
    nlDeleting.current = true;
    try { await Promise.all([deleteNewsletter(newsletterId), releaseLockNow()]); } catch {}
    router.push("/admin/imago");
  }

  function restoreNlVersion(v: NlVersion) {
    if (!confirm("Restore this version? Your current text will be replaced.")) return;
    setNlSubject(v.subject ?? "");
    setNlPreview(v.preview ?? "");
    setNlAuthor(v.author ?? "Yacob Reyes");
    const srcCards = (v.cards ?? []) as StoredCard[];
    setNlCards((srcCards.length ? srcCards : [{}]).map(c => ({
      ...newNlCard(),
      headline: c.headline ?? "",
      deck: c.deck || undefined,
      doc: c.body?.length ? portableTextToTiptap(c.body) : EMPTY_DOC,
      image: c.image ?? undefined,
      cardType: mapStoredCardType(c.cardType),
      byline: c.byline || undefined,
      sourceSlug: c.sourceSlug || undefined,
      date: c.date || undefined,
    })));
  }

  const nlActiveE = nlActiveEditor;
  const findFiltered = findPosts.filter(p => {
    const isDraftOrScheduled = p.status === "draft" || p.status === "scheduled";
    if (findShowDraftScheduled ? !isDraftOrScheduled : isDraftOrScheduled) return false;
    const q = findQuery.trim().toLowerCase();
    if (!q) return true;
    const bodyText = ptPlainText(p.body as { _type?: string; children?: { text?: string }[] }[]).toLowerCase();
    return p.headline.toLowerCase().includes(q) || p.byline?.toLowerCase().includes(q) || p.section?.toLowerCase().includes(q) || p.slug?.toLowerCase().includes(q) || bodyText.includes(q);
  });

  // Single source for the formatting toolbar buttons. Rendered in the top bar
  // on desktop (unchanged) and in a row below the top bar on mobile (Axios
  // position) — one fragment, two placements, no duplication.
  const nlToolbarButtons = nlActiveE && !nlActiveE.isDestroyed && !nlReadOnly ? (
    <>
      <button type="button" title="Undo" disabled={!nlActiveE.can().undo()} onMouseDown={e => { e.preventDefault(); nlActiveE.chain().focus().undo().run(); }}
        style={{ background: "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: nlActiveE.can().undo() ? "pointer" : "default", color: TEXT_MUTED, opacity: nlActiveE.can().undo() ? 1 : 0.4 }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
      </button>
      <button type="button" title="Redo" disabled={!nlActiveE.can().redo()} onMouseDown={e => { e.preventDefault(); nlActiveE.chain().focus().redo().run(); }}
        style={{ background: "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: nlActiveE.can().redo() ? "pointer" : "default", color: TEXT_MUTED, opacity: nlActiveE.can().redo() ? 1 : 0.4 }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
      </button>
      <div style={{ width: 1, height: 22, background: BORDER, margin: "0 0.3rem", flexShrink: 0 }} />
      {([
        ["B", nlActiveE.isActive("bold"), () => nlActiveE.chain().focus().toggleBold().run(), { fontWeight: 700 }],
        ["I", nlActiveE.isActive("italic"), () => nlActiveE.chain().focus().toggleItalic().run(), { fontStyle: "italic" }],
      ] as [string, boolean, () => void, React.CSSProperties][]).map(([label, active, action, style]) => (
        <button key={label} type="button" onMouseDown={e => { e.preventDefault(); action(); }}
          style={{ background: active ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: active ? CRIMSON : TEXT_MUTED, fontFamily: FONT, fontSize: "1.15rem", ...style }}>
          {label}
        </button>
      ))}
      <button type="button" onMouseDown={e => { e.preventDefault(); nlActiveE.chain().focus().toggleBlockquote().run(); }}
        style={{ background: nlActiveE.isActive("blockquote") ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: nlActiveE.isActive("blockquote") ? CRIMSON : TEXT_MUTED }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
      <button type="button" onMouseDown={e => { e.preventDefault(); nlActiveE.chain().focus().toggleHeading({ level: 2 }).run(); }}
        style={{ background: nlActiveE.isActive("heading", { level: 2 }) ? "#ffffff" : "none", border: "none", borderRadius: 4, padding: "0 8px", height: 38, flexShrink: 0, display: "flex", alignItems: "center", cursor: "pointer", color: nlActiveE.isActive("heading", { level: 2 }) ? CRIMSON : TEXT_MUTED, fontFamily: FONT, fontSize: "1rem", fontWeight: 700 }}>
        H2
      </button>
      <div style={{ width: 1, height: 22, background: BORDER, margin: "0 0.3rem", flexShrink: 0 }} />
      <button type="button" onMouseDown={e => { e.preventDefault(); nlActiveE.chain().focus().toggleBulletList().run(); }}
        style={{ background: nlActiveE.isActive("bulletList") ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: nlActiveE.isActive("bulletList") ? CRIMSON : TEXT_MUTED }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
      <button type="button" onMouseDown={e => { e.preventDefault(); nlActiveE.chain().focus().toggleOrderedList().run(); }}
        style={{ background: nlActiveE.isActive("orderedList") ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: nlActiveE.isActive("orderedList") ? CRIMSON : TEXT_MUTED }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
      </button>
      <div style={{ width: 1, height: 22, background: BORDER, margin: "0 0.3rem", flexShrink: 0 }} />
      <button type="button" onMouseDown={e => { e.preventDefault(); nlActiveToolbar?.openLink(); }}
        style={{ background: nlActiveE.isActive("link") ? "#ffffff" : "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: nlActiveE.isActive("link") ? CRIMSON : TEXT_MUTED }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </button>
      <button type="button" onMouseDown={e => { e.preventDefault(); nlActiveToolbar?.openImage(); }}
        style={{ background: "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: TEXT_MUTED }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </button>
      <button type="button" onMouseDown={e => { e.preventDefault(); nlActiveToolbar?.openEmbed(); }}
        style={{ background: "none", border: "none", borderRadius: 4, width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: TEXT_MUTED }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      </button>
    </>
  ) : null;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f5f8fa" }}>
      <EditLockBanner holder={nlLocked ? lockHolder : null} selfOtherTab={selfOtherTab} onTakeOver={takeOver} />
      {viewMode && !nlLocked && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 400,
          display: "flex", alignItems: "center", justifyContent: "center", gap: "1.25rem",
          background: "#ffffff", borderTop: `1px solid ${BORDER}`,
          boxShadow: "0 -2px 16px rgba(0,0,0,0.08)", padding: "0.85rem 1.25rem", paddingBottom: "calc(0.85rem + var(--safe-bottom))",
          fontFamily: FONT, fontSize: "0.9rem", color: TEXT_DARK,
        }}>
          <span>
            {(() => {
              // Prefer the precise send time (sentAt); fall back to the last
              // edit date for newsletters published before we recorded it.
              const publishedLabel = initial?.sentAt ? formatPublishedTime(initial.sentAt) : formatEtDate(initial?.lastEditedAt);
              return nlStatus === "scheduled"
                ? `This newsletter was scheduled${initial?.scheduledBy ? ` by ${initial.scheduledBy}` : ""} for ${formatScheduledTime(nlScheduledAt)}.`
                : viewLockHolder
                  ? `${viewLockHolder.name} is currently editing this. Do you want to kick them out?`
                  : nlStatus === "published"
                    ? `This newsletter was published${publishedLabel ? ` on ${publishedLabel}` : ""}. Do you want to make changes?`
                    : "You’re viewing this newsletter. Do you want to make changes?";
            })()}
          </span>
          <button type="button" onClick={nlStatus === "scheduled" ? unscheduleNlToEdit : () => { setViewMode(false); if (viewLockHolder) setTimeout(takeOver, 100); }} style={{
            background: CRIMSON, color: "#fff", border: "none", borderRadius: 22,
            padding: "0.5rem 1.25rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600,
            cursor: "pointer", whiteSpace: "nowrap",
          }}>{nlStatus === "scheduled" ? "Unschedule to edit" : viewLockHolder ? "Kick them out" : "Start editing"}</button>
        </div>
      )}
      <style>{`
        /* Match the body to the editor canvas. Without this the body stayed
           default white under the #f5f8fa canvas, so overscroll (pull-down)
           revealed a white band between the header and the content — the
           dashboard and story editor both pin body for the same reason. */
        html { background: white !important; }
        body { background: #f5f8fa !important; }
        .nl-tb-btn { position: relative; }
        .nl-add-zone .nl-add-line, .nl-add-zone .nl-add-label { opacity: 0; transition: opacity 0.12s; }
        .nl-add-zone:hover .nl-add-line, .nl-add-zone:hover .nl-add-label { opacity: 1; }
        .nl-card-controls { opacity: 0; transition: opacity 0.12s; pointer-events: none; }
        .nl-card:hover .nl-card-controls, .nl-card-controls:hover { opacity: 1; pointer-events: auto; }
        .nl-find-panel { scrollbar-width: thin; scrollbar-color: ${BORDER} transparent; }
        .nl-find-panel::-webkit-scrollbar { width: 8px; }
        .nl-find-panel::-webkit-scrollbar-track { background: transparent; }
        .nl-find-panel::-webkit-scrollbar-thumb { background: ${BORDER}; border-radius: 4px; }
        .nl-find-panel::-webkit-scrollbar-thumb:hover { background: ${TEXT_MUTED}; }
      `}</style>

      {nlImgPickerCard && (
        <ImagePickerModal
          isMobile={isMobile}
          onClose={() => setNlImgPickerCard(null)}
          onSelect={img => nlUpdateCard(nlImgPickerCard, { image: img })}
        />
      )}

      {/* Schedule modal */}
      {showNlScheduler && (
        <ScheduleModal
          value={nlScheduledAt}
          onChange={setNlScheduledAt}
          onConfirm={scheduleNewsletter}
          onClose={() => setShowNlScheduler(false)}
          label="newsletter"
        />
      )}

      {/* Preview modal — renders the actual email HTML */}
      {showNlPreview && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }} onClick={() => setShowNlPreview(false)}>
          <div style={{ background: "white", borderRadius: 8, width: "min(680px, 100%)", height: "90vh", overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1.25rem", borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontFamily: FONT, fontWeight: 700, color: TEXT_DARK }}>Email preview</span>
              <button type="button" onClick={() => setShowNlPreview(false)} style={{ background: "none", border: "none", fontSize: "1.4rem", cursor: "pointer", color: TEXT_MUTED }}>×</button>
            </div>
            <iframe title="Newsletter preview" style={{ flex: 1, border: "none", width: "100%" }}
              srcDoc={renderNewsletterHtml({
                subject: nlSubject, preview: nlPreview, intro: nlIntro, author: nlAuthor, volume: nlVolume, issue: nlIssue, classics: nlClassics,
                baseUrl: typeof window !== "undefined" ? window.location.origin : undefined,
                cards: nlCards.map(c => ({ headline: c.headline, deck: c.deck, body: tiptapToPortableText(c.doc), image: c.image ? { url: c.image.url, caption: c.image.caption, alt: c.image.alt } : null, cardType: c.cardType, byline: c.byline, date: c.date })),
              })} />
          </div>
        </div>
      )}

      {/* Floating "find content" trigger — fixed to the left edge, hidden while the panel is open */}
      {!isMobile && !showFindContent && !showOnThisDay && !nlReadOnly && (
        <button type="button" title="Find content" onClick={() => setShowFindContent(true)}
          style={{ position: "fixed", top: "calc(80px + var(--safe-top))", left: 24, zIndex: 50, width: 44, height: 44, borderRadius: "50%", background: CRIMSON, color: "white", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.2)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </button>
      )}

      {/* "On this day in Gangrey" clock — Classics only, sits below Find content */}
      {nlClassics && !isMobile && !showFindContent && !showOnThisDay && !nlReadOnly && (
        <button type="button" title="On this day in Gangrey" onClick={() => setShowOnThisDay(true)}
          style={{ position: "fixed", top: "calc(132px + var(--safe-top))", left: 24, zIndex: 50, width: 44, height: 44, borderRadius: "50%", background: "white", color: CRIMSON, border: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.14)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
        </button>
      )}

      {/* On this day panel — archive pieces first published on today's date */}
      {showOnThisDay && !nlReadOnly && (
        <div className="nl-find-panel" style={{ position: "fixed", top: "calc(64px + var(--safe-top))", left: 12, height: "calc(100% - 76px - var(--safe-top))", width: 296, maxWidth: "88vw", zIndex: 400, background: "white", border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: "4px 0 24px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "1rem 1.25rem", borderBottom: `1px solid ${BORDER}` }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: FONT, fontWeight: 700, color: TEXT_DARK }}>On this day in Gangrey</span>
              <span style={{ display: "block", fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED, marginTop: 2 }}>First published on {new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric" })}</span>
            </span>
            <button type="button" title="Close" onClick={() => setShowOnThisDay(false)} style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", color: TEXT_MUTED, lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {onThisDayLoading ? (
              <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, padding: "1rem 1.25rem" }}>Looking through the archive…</p>
            ) : onThisDay.length === 0 ? (
              <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, padding: "1rem 1.25rem" }}>No archive pieces first ran on this date. Use Find content to pull in a piece from another day.</p>
            ) : onThisDay.map(p => (
              <button key={p.id} type="button" onClick={() => insertPostAsCard(p, nlCards.length)}
                style={{ display: "flex", alignItems: "center", gap: "0.7rem", width: "100%", background: "none", border: "none", borderBottom: `1px solid ${BORDER}`, padding: "0.85rem 1.25rem", cursor: "pointer", textAlign: "left" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f7f7f7")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                <span style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 800, color: CRIMSON, flexShrink: 0, width: 36 }}>{(p.date ?? "").slice(0, 4)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: FONT, fontSize: "0.9rem", fontWeight: 600, color: TEXT_DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.headline || "Untitled"}</span>
                  {p.byline && <span style={{ display: "block", fontFamily: FONT, fontSize: "0.76rem", color: TEXT_MUTED }}>{p.byline}</span>}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={CRIMSON} strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Find content panel — pull a story in as a new card */}
      {showFindContent && !nlReadOnly && (
        <div className="nl-find-panel" style={{ position: "fixed", top: "calc(64px + var(--safe-top))", left: 12, height: "calc(100% - 76px - var(--safe-top))", width: 296, maxWidth: "88vw", zIndex: 400, background: "white", border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: "4px 0 24px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem", borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontFamily: FONT, fontWeight: 700, color: TEXT_DARK }}>Find content</span>
              <button type="button" title="Close" onClick={() => setShowFindContent(false)} style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", color: TEXT_MUTED, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem", borderBottom: `1px solid ${BORDER}` }}>
              <input value={findQuery} onChange={e => setFindQuery(e.target.value)} placeholder="Search by headline, keyword or url" style={INPUT} />
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer" }} onClick={() => setFindShowDraftScheduled(v => !v)}>
                <span style={{ width: 32, height: 18, borderRadius: 10, background: findShowDraftScheduled ? CRIMSON : "#b8b8ba", position: "relative", transition: "background 0.15s", flexShrink: 0 }}>
                  <span style={{ position: "absolute", top: 2, left: findShowDraftScheduled ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "white", transition: "left 0.15s" }} />
                </span>
                <span style={{ fontFamily: FONT, fontSize: "0.82rem", color: TEXT_MUTED }}>Only draft and scheduled</span>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {findLoading ? (
                <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, padding: "1rem 1.25rem" }}>Loading…</p>
              ) : findFiltered.length === 0 ? (
                <p style={{ fontFamily: FONT, fontSize: "0.85rem", color: TEXT_MUTED, padding: "1rem 1.25rem" }}>No stories found.</p>
              ) : findFiltered.map(p => (
                <div key={p.id} onMouseDown={e => startInsertPost(e, p)}
                  style={{ padding: "0.85rem 1.25rem", borderBottom: `1px solid ${BORDER}`, cursor: "grab", userSelect: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                    <span style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.byline || "Unknown"}{p.section ? ` · ${p.section}` : ""}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: TEXT_MUTED, marginLeft: "0.5rem" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
                  </div>
                  <p style={{ fontFamily: FONT, fontSize: "0.9rem", fontWeight: 600, color: TEXT_DARK, margin: 0 }}>{p.headline || "Untitled"}</p>
                  <p style={{ fontFamily: FONT, fontSize: "0.72rem", color: TEXT_MUTED, margin: "0.3rem 0 0" }}>
                    {p.status === "draft" ? "Draft" : p.status === "scheduled" ? `Scheduled for ${formatFindContentDate(p.date)}` : `Published on ${formatFindContentDate(p.date)}`}
                  </p>
                </div>
              ))}
            </div>
            <div style={{ padding: "0.75rem 1.25rem", borderTop: `1px solid ${BORDER}` }}>
              <p style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, margin: 0 }}>Press and drag a story into the newsletter to add it as a card.</p>
            </div>
        </div>
      )}

      {/* Floating chip for a story being dragged in from the find-content panel */}
      {nlInsertingPost && (
        <div ref={nlInsertChipRef} style={{ position: "fixed", top: 0, left: 0, zIndex: 1000, pointerEvents: "none", background: "white", border: `1px solid ${CRIMSON}`, borderRadius: 4, padding: "0.65rem 1rem", boxShadow: "0 10px 30px rgba(0,0,0,0.22)", maxWidth: 260 }}>
          <span style={{ fontFamily: FONT, fontSize: "0.92rem", fontWeight: 700, color: TEXT_DARK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{nlInsertingPost.headline || "Untitled story"}</span>
        </div>
      )}

      {/* Top bar — matches story editor */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 1.5rem", paddingTop: "var(--safe-top)", borderBottom: `1px solid ${BORDER}`, height: "calc(52px + var(--safe-top))", boxSizing: "border-box", flexShrink: 0, background: "white", position: "fixed", top: 0, left: 0, right: 0, zIndex: 410 }}>
        <button disabled={nlExiting} onClick={nlReadOnly ? () => router.push("/admin/imago") : saveAndExit} style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "none", border: "none", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, color: TEXT_MUTED, cursor: nlExiting ? "default" : "pointer", opacity: nlExiting ? 0.55 : 1, padding: 0, whiteSpace: "nowrap" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          {nlExiting ? "Saving…" : nlReadOnly ? "Go Back" : "Save & Exit"}
        </button>

        {/* Desktop: formatting toolbar lives in the top bar (unchanged) */}
        {!isMobile && nlToolbarButtons && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>{nlToolbarButtons}</div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED }}>{nlReadOnly ? "Read only" : nlSending ? "Sending…" : nlSaveStatus === "saving" ? "Saving…" : nlSaveStatus === "unsaved" ? "Unsaved" : "Saved"}</span>
          {!nlReadOnly && !isMobile && (
            <select
              value={nlAudience}
              onChange={e => setNlAudience(e.target.value as "all" | "free" | "members")}
              title="Who receives this send"
              style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_DARK, border: `1px solid ${BORDER}`, borderRadius: 20, padding: "0.3rem 0.6rem", background: "white", cursor: "pointer", outline: "none" }}>
              <option value="all">Everyone</option>
              <option value="free">Free subscribers</option>
              <option value="members">Paid members</option>
            </select>
          )}
          <button
            disabled={nlReadOnly || !nlSubject || nlSending}
            onClick={publishNewsletter}
            style={{ background: CRIMSON, color: "white", border: "none", borderRadius: 20, padding: "0.35rem 1.1rem", fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, cursor: nlReadOnly || !nlSubject ? "not-allowed" : "pointer", opacity: nlReadOnly || !nlSubject || nlSending ? 0.5 : 1 }}>
            {nlStatus === "published" ? "Update" : "Publish"}
          </button>
          {/* Ellipsis menu */}
          <div style={{ position: "relative" }}>
            <button type="button" disabled={nlReadOnly} onClick={() => setShowNlEllipsis(v => !v)}
              style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: nlReadOnly ? "default" : "pointer", color: TEXT_MUTED, opacity: nlReadOnly ? 0.5 : 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
            </button>
            {showNlEllipsis && (
              <div style={{ position: "absolute", top: "calc(100% + 0.4rem)", right: 0, zIndex: 100, background: "white", border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 180, overflow: "hidden" }} onClick={() => setShowNlEllipsis(false)}>
                <button type="button" onClick={async () => {
                  setNlSending(true);
                  try {
                    const d = await sendTestNewsletter(newsletterId);
                    alert(d.ok ? "Test email sent to yacob@gangrey.org." : (d.error || "Test send failed."));
                  } catch { alert("Test send failed."); }
                  finally { setNlSending(false); }
                }} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: TEXT_DARK, cursor: "pointer" }}>Send test email</button>
                {/* An already-published newsletter can't be scheduled — hide it. */}
                {nlStatus !== "published" && (
                  <button type="button" onClick={() => { if (!nlSubject.trim()) { alert("Add a subject line before scheduling."); return; } const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); setNlScheduledAt(d.toISOString().slice(0, 16)); setShowNlScheduler(true); }} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: TEXT_DARK, cursor: "pointer" }}>Schedule</button>
                )}
                <button type="button" onClick={() => setShowNlPreview(true)} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: TEXT_DARK, cursor: "pointer" }}>Preview</button>
                {nlStatus === "published" && (
                  <>
                    <button type="button" onClick={async () => {
                      if (!confirm(`Resend this newsletter to ${nlAudience === "all" ? "all subscribers" : nlAudience === "members" ? "paid members" : "free subscribers"}?`)) return;
                      setNlSending(true);
                      try {
                        const d = await sendNewsletter(newsletterId, nlAudience);
                        if (!d.ok) alert(d.error || "Send failed.");
                        else alert(`Sent to ${d.sent} ${AUDIENCE_LABEL[nlAudience]}${d.sent === 1 ? "" : "s"}.${d.failed ? ` ${d.failed} failed.` : ""}`);
                      } catch { alert("Send failed."); }
                      finally { setNlSending(false); }
                    }} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: TEXT_DARK, cursor: "pointer" }}>Resend email</button>
                    <button type="button" onClick={unpublishNewsletter} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: TEXT_DARK, cursor: "pointer" }}>Unpublish</button>
                  </>
                )}
                <div style={{ borderTop: `1px solid ${BORDER}` }} />
                <button type="button" onClick={removeNewsletter} style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.65rem 1rem", fontFamily: FONT, fontSize: "0.88rem", color: CRIMSON, cursor: "pointer" }}>Delete draft</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: formatting toolbar as its own row below the top bar (Axios
          position). Desktop keeps it inside the top bar — unchanged. */}
      {isMobile && nlToolbarButtons && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", padding: "0.25rem 0.75rem", borderBottom: `1px solid ${BORDER}`, background: "white", flexShrink: 0, position: "fixed", top: "calc(52px + var(--safe-top))", left: 0, right: 0, zIndex: 405, overflowX: "auto", overflowY: "hidden", touchAction: "pan-x", overscrollBehavior: "contain" }}>
          {nlToolbarButtons}
        </div>
      )}

      {/* Floating drag chip */}
      {nlMovingId && (() => {
        const mc = nlCards.find(c => c.id === nlMovingId);
        if (!mc) return null;
        const mcType = mc.cardType ?? "essays";
        const mcLabel = mcType === "narratives" ? "NARRATIVES" : mcType === "essays" ? "ESSAYS" : mcType === "archive" ? "FROM THE ARCHIVE" : "MICRO-MEMOIR";
        return (
          <div ref={nlMoveChipRef} style={{ position: "fixed", left: nlMoveRectRef.current.left, top: 0, width: nlMoveRectRef.current.width, zIndex: 1000, pointerEvents: "none", background: "white", border: `2px solid ${CRIMSON}`, padding: "0.65rem 0.9rem", boxShadow: "0 10px 30px rgba(0,0,0,0.22)", display: "flex", alignItems: "center", gap: "0.6rem", boxSizing: "border-box" }}>
            <span style={{ fontFamily: FONT, fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.15em", color: CRIMSON, textTransform: "uppercase", flexShrink: 0 }}>{mcLabel}</span>
            <span style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.95rem", color: TEXT_DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mc.headline?.trim() || "—"}</span>
          </div>
        );
      })()}

      {/* Content — when the find panel is open on desktop, reserve its width on
          the left so the centered page never slides underneath it. */}
      <div style={{ flex: 1, overflowY: "auto", background: "#f5f8fa", paddingTop: "2rem", paddingBottom: "4rem", paddingRight: "1rem", paddingLeft: (showFindContent || showOnThisDay) && !isMobile ? 320 : "1rem", transition: "padding-left 0.2s", marginTop: isMobile && nlActiveE && !nlActiveE.isDestroyed && !nlReadOnly ? "calc(101px + var(--safe-top))" : "calc(52px + var(--safe-top))" }}>
        {/* Magazine page — 600px to match the email's inbox-safe width */}
        <div style={{ maxWidth: 600, margin: "0 auto", background: "#ffffff", boxShadow: "0 4px 32px rgba(0,0,0,0.18)" }}>

          {/* View in browser — shown in the sent email once published; inert
              here since the issue page doesn't exist until publish, but shown
              so the preview matches what subscribers actually see. */}
          <div style={{ background: "#000000", padding: "0.6rem 1rem 0", textAlign: "center" }}>
            <span style={{ fontFamily: FONT, fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#b8b8ba" }}>View in browser</span>
          </div>

          {/* Cover masthead — black panel, keyline border, white wordmark (matches the email) */}
          <div style={{ background: "#000000", padding: "1rem" }}>
            <div style={{ border: `1px solid #b8b8ba`, padding: "1.9rem 2.1rem 1.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.4rem" }}>
                <span style={{ fontFamily: FONT, fontSize: "0.55rem", letterSpacing: "0.28em", textTransform: "uppercase", color: "#b8b8ba" }}>A Literary Magazine</span>
                <span style={{ fontFamily: FONT, fontSize: "0.55rem", letterSpacing: "0.28em", textTransform: "uppercase", color: "#b8b8ba" }}>Gangrey.org</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={nlClassics ? "/wordmark-classics-email-hd.png" : "/wordmark-white-email-hd.png"} alt="Gangrey" width={290} style={{ width: 290, maxWidth: "100%", display: "block", margin: "0 auto 1.1rem" }} />
              <div style={{ width: 40, height: 2, background: CRIMSON, margin: "0 auto 1.1rem" }} />
              {nlSubject && (
                <p style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "1.35rem", lineHeight: 1.3, color: "#ffffff", textAlign: "center", margin: "0 0 0.5rem" }}>{nlSubject}</p>
              )}
              <div style={{ maxWidth: 440, margin: "0 auto" }}>
                <textarea
                  ref={nlIntroRef}
                  value={nlIntro}
                  onChange={e => setNlIntro(straightenQuotes(e.target.value))}
                  readOnly={nlReadOnly}
                  placeholder="A note to readers…"
                  rows={1}
                  style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.95rem", lineHeight: 1.6, color: "#b8b8ba", border: "none", outline: "none", width: "100%", background: "transparent", padding: 0, resize: "none", boxSizing: "border-box", display: "block", textAlign: "center", overflow: "hidden" }}
                />
                {!nlClassics && nlAuthor && (
                  <p style={{ fontFamily: FONT, fontSize: "0.62rem", fontWeight: 400, color: "#b8b8ba", margin: "0.9rem 0 0", letterSpacing: "0.22em", textTransform: "uppercase", textAlign: "center" }}>Guest Editor · <span style={{ color: "#ffffff" }}>{nlAuthor}</span></p>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid #b8b8ba`, marginTop: "1.4rem", paddingTop: "0.9rem" }}>
                <span style={{ fontFamily: FONT, fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "#ffffff" }}>Est. 2026</span>
                {nlClassics ? (
                  <span style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.75rem", color: "#ffffff" }}>
                    {coverDateLabel}
                  </span>
                ) : (
                  <span style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.75rem", color: "#ffffff" }}>
                    {nlVolume ? <><span style={{ color: "#b8b8ba" }}>Vol.</span> {nlVolume} </> : ""}{nlIssue ? <><span style={{ color: "#b8b8ba" }}>No.</span> {nlIssue}</> : ""}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Cards — black ground (matches the email) so white article sheets
              float on it with a 16px gutter. */}
          <div style={{ background: "#000000", padding: "1rem 1rem 0" }}>
            {(() => { let archiveOrdinal = -1; return nlCards.map((card, i) => {
              const type = card.cardType ?? (i === 0 ? "narratives" : "essays");
              // Torn-clipping/tape variant is keyed to a card's position among
              // OTHER ARCHIVE cards, not its position in the whole newsletter —
              // matching the email renderer's `archiveN` counter. Otherwise
              // dragging any card (archive or not) into the list shifts every
              // later archive card's overall array index, which used to flip
              // its tear/tape variant even though nothing about that card changed.
              if (type === "archive") archiveOrdinal++;
              const sectionLabel = type === "narratives" ? "NARRATIVES" : type === "essays" ? "ESSAYS" : type === "archive" ? "FROM THE ARCHIVE" : "MICRO-MEMOIR";
              // Essays/Narratives render as white "sheets" floating on the black
              // ground; micro-memoir & archive supply their own card chrome.
              const sheet = type === "essays" || type === "narratives";
              const isDragging = nlMovingId === card.id;
              // While any card is being dragged, collapse all others to a slim handle row
              // so the cursor only needs to travel a short distance to swap order.
              const collapsed = !!nlMovingId && !isDragging;
              return (
                <div key={card.id}>
                  {/* Add zone between cards */}
                  <div className="nl-add-zone" onClick={() => { if (!nlReadOnly) nlAddCardAfter(i - 1); }}
                    style={{ display: "flex", alignItems: "center", gap: "0.6rem", height: 24, cursor: nlReadOnly ? "default" : "pointer", visibility: nlReadOnly ? "hidden" : "visible" }}>
                    <div className="nl-add-line" style={{ flex: 1, height: 1, background: "#ddd" }} />
                    <span className="nl-add-label" style={{ fontFamily: FONT, fontSize: "0.7rem", color: "#b8b8ba", whiteSpace: "nowrap", padding: "0 0.3rem" }}>+ Add section</span>
                    <div className="nl-add-line" style={{ flex: 1, height: 1, background: "#ddd" }} />
                  </div>

                  <div className="nl-card" draggable={false}
                    ref={el => { nlCardRefs.current[card.id] = el; }}
                    onFocusCapture={() => { const ed = nlEditors.current[card.id]; setNlActiveEditor(ed && !ed.isDestroyed ? ed : null); setNlActiveToolbar(nlToolbars.current[card.id] ?? null); }}
                    style={{ position: "relative", pointerEvents: isDragging ? "none" : undefined, cursor: nlMovingId && !isDragging ? "pointer" : undefined, ...(sheet && !isDragging && !collapsed ? { background: "#ffffff", padding: "0.5rem 2rem 1.5rem", marginBottom: "1rem" } : {}) }}>

                  {/* Placeholder drop-slot — the dragged card itself, shown as a slim
                      dashed gap so the rest of the list stays compact while moving. */}
                  {isDragging ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.65rem 0", borderBottom: `1px solid ${BORDER}`, opacity: 0.5 }}>
                      <span style={{ fontFamily: FONT, fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.15em", color: CRIMSON, textTransform: "uppercase", flexShrink: 0 }}>{sectionLabel}</span>
                      <span style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.95rem", color: TEXT_DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.headline?.trim() || "—"}</span>
                    </div>
                  ) : collapsed ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.65rem 0", borderBottom: `1px solid ${BORDER}` }}>
                      <span style={{ fontFamily: FONT, fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.15em", color: CRIMSON, textTransform: "uppercase", flexShrink: 0 }}>{sectionLabel}</span>
                      <span style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.95rem", color: TEXT_DARK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.headline?.trim() || "—"}</span>
                    </div>
                  ) : (<>

                    {/* Section label — small-caps flag, non-editable. Matches the
                        sent email exactly: narratives/essays/micro-memoir all get
                        a kicker; archive does NOT — its identity comes from the
                        "Gangrey · Archive · date" running head baked into the
                        clipping paper itself, not a separate label above it. */}
                    {type !== "archive" && (
                      // paddingTop only matters visually for micro-memoir: essay/
                      // narrative labels sit inset inside a white sheet that
                      // already fills from the wrapper's top edge, so their own
                      // paddingTop is invisible from outside. Micro-memoir has no
                      // such background — its label is the first visible pixel —
                      // so it needs the same near-zero offset as the others, or
                      // the hover toolbar (anchored a fixed distance above the
                      // wrapper) floats further from it than from every other type.
                      <div style={{ paddingTop: sheet ? "0.75rem" : "0", fontFamily: FONT, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.24em", color: sheet ? CRIMSON : "#b8b8ba", marginBottom: "0.4rem" }}>
                        {sectionLabel}
                      </div>
                    )}

                    {/* Card hover toolbar — all writes (move, retype, delete), so
                        none of it renders in read-only. */}
                    {!nlMovingId && !nlReadOnly && (
                      <div className="nl-card-controls" style={{ position: "absolute", top: "-2.2rem", left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10, pointerEvents: "none" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", pointerEvents: "auto" }}>
                          <button type="button" title="Move" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); const r = nlCardRefs.current[card.id]?.getBoundingClientRect(); if (r) nlMoveRectRef.current = { left: r.left, width: r.width }; nlMoveStartYRef.current = e.clientY; setNlMovingId(card.id); }}
                            style={{ width: 28, height: 28, borderRadius: 4, background: "white", border: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", color: TEXT_MUTED, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                          </button>
                          {(nlClassics
                            ? ([["archive", "Archive"]] as const)
                            : ([["narratives", "Narratives"], ["essays", "Essays"], ["micro-memoir", "Micro-Memoir"], ["archive", "Archive"]] as const)
                          ).map(([t, label]) => {
                            const active = type === t;
                            return (
                              <button key={t} type="button" onClick={() => nlUpdateCard(card.id, { cardType: t })}
                                style={{ fontFamily: FONT, fontSize: "0.65rem", fontWeight: 600, padding: "0.15rem 0.5rem", borderRadius: 20, border: `1px solid ${active ? CRIMSON : BORDER}`, background: active ? CRIMSON : "white", color: active ? "white" : TEXT_MUTED, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        <button type="button" title="Delete" onClick={() => { if (nlCards.length > 1 && confirm("Delete this section?")) nlRemoveCard(card.id); }}
                          style={{ width: 28, height: 28, borderRadius: 4, background: "white", border: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: nlCards.length > 1 ? "pointer" : "not-allowed", color: TEXT_MUTED, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", opacity: nlCards.length > 1 ? 1 : 0.4, pointerEvents: "auto" }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    )}

                    {/* NARRATIVES card */}
                    {type === "narratives" && (
                      <div style={{ paddingTop: "1rem", paddingBottom: "2rem" }}>
                        {card.image ? (
                          <div style={{ margin: "0 0 1.75rem", position: "relative" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={sized(card.image.url, 1040)} alt={card.image.alt ?? ""} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
                            <input value={card.image.caption ?? ""} onChange={e => nlUpdateCard(card.id, { image: { ...card.image!, caption: straightenQuotes(e.target.value) } })}
                              placeholder="Add a caption…" readOnly={nlReadOnly}
                              style={{ fontFamily: FONT, fontSize: "0.7rem", color: TEXT_MUTED, fontStyle: "italic", border: "none", outline: "none", background: "transparent", width: "100%", padding: 0, margin: "0.4rem 1rem 0", boxSizing: "border-box", display: "block" }} />
                            <div className="nl-card-controls" style={{ position: "absolute", top: "0.5rem", right: "0.5rem", display: "flex", gap: "0.35rem" }}>
                              <button type="button" onClick={() => setNlImgPickerCard(card.id)} disabled={nlReadOnly} style={{ background: "rgba(0,0,0,0.65)", color: "white", border: "none", borderRadius: 4, padding: "0.2rem 0.55rem", fontFamily: FONT, fontSize: "0.7rem", cursor: nlReadOnly ? "default" : "pointer" }}>Change</button>
                              <button type="button" onClick={() => nlUpdateCard(card.id, { image: undefined })} disabled={nlReadOnly} style={{ background: "rgba(0,0,0,0.65)", color: "white", border: "none", borderRadius: 4, padding: "0.2rem 0.55rem", fontFamily: FONT, fontSize: "0.7rem", cursor: nlReadOnly ? "default" : "pointer" }}>Remove</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setNlImgPickerCard(card.id)} disabled={nlReadOnly} style={{ display: "block", width: "100%", margin: "0 0 1.75rem", background: "#ffffff", border: `2px dashed ${BORDER}`, color: TEXT_MUTED, fontFamily: FONT, fontSize: "0.85rem", padding: "3rem 0", cursor: nlReadOnly ? "default" : "pointer", opacity: nlReadOnly ? 0.6 : 1, textAlign: "center", boxSizing: "border-box" }}>
                            + Add a featured image
                          </button>
                        )}
                        <input value={card.headline} onChange={e => nlUpdateCard(card.id, { headline: e.target.value })} readOnly={nlReadOnly} placeholder="Type your headline"
                          style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "1.9rem", fontWeight: 700, lineHeight: 1.15, color: TEXT_DARK, border: "none", outline: "none", width: "100%", background: "transparent", padding: 0, marginBottom: "0.6rem", display: "block", boxSizing: "border-box", textAlign: "center" }} />
                        <textarea value={card.deck ?? ""} onChange={e => nlUpdateCard(card.id, { deck: e.target.value })} readOnly={nlReadOnly} placeholder="Type your subheadline (optional)" rows={1}
                          style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "1.2rem", lineHeight: 1.45, color: TEXT_MUTED, border: "none", outline: "none", width: "100%", maxWidth: 440, margin: "0 auto 1rem", background: "transparent", padding: 0, resize: "none", boxSizing: "border-box", display: "block", textAlign: "center", overflow: "hidden" }} />
                        {nlBylineField(card, "center")}
                        <RichBodyEditor initialContent={card.doc} editable={!nlReadOnly} minHeight={80} 
                          onChange={doc => nlUpdateCard(card.id, { doc })}
                          onEditor={ed => { nlEditors.current[card.id] = ed; if (ed) { setNlActiveEditor(prev => prev && !prev.isDestroyed ? prev : ed); } else { setNlActiveEditor(prev => prev?.isDestroyed ? null : prev); } }}
                          onToolbar={tb => { nlToolbars.current[card.id] = tb; if (tb && i === 0) setNlActiveToolbar(prev => prev ?? tb); }} />
                        {nlCardDraftRow(card, "center")}
                      </div>
                    )}

                    {/* ESSAYS card */}
                    {type === "essays" && (
                      <div style={{ paddingTop: "1rem", paddingBottom: "1.75rem" }}>
                        <div style={{ borderTop: `2px solid ${CRIMSON}`, paddingTop: "0.85rem", marginBottom: "0.85rem" }}>
                          <input value={card.headline} onChange={e => nlUpdateCard(card.id, { headline: e.target.value })} readOnly={nlReadOnly} placeholder="Type your headline"
                            style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "1.9rem", fontWeight: 700, lineHeight: 1.15, color: TEXT_DARK, border: "none", outline: "none", width: "100%", background: "transparent", padding: 0, boxSizing: "border-box", display: "block" }} />
                        </div>
                        <textarea value={card.deck ?? ""} onChange={e => nlUpdateCard(card.id, { deck: e.target.value })} readOnly={nlReadOnly} placeholder="Type your subheadline (optional)" rows={1}
                          style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "1.2rem", lineHeight: 1.45, color: TEXT_MUTED, border: "none", outline: "none", width: "100%", margin: "0 0 0.85rem", background: "transparent", padding: 0, resize: "none", boxSizing: "border-box", display: "block", overflow: "hidden" }} />
                        {nlBylineField(card, "left")}
                        {card.image ? (
                          <div style={{ margin: "0 0 0.85rem", position: "relative" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={sized(card.image.url, 700)} alt={card.image.alt ?? ""} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
                            <div className="nl-card-controls" style={{ position: "absolute", top: "0.4rem", right: "0.4rem", display: "flex", gap: "0.35rem" }}>
                              <button type="button" onClick={() => setNlImgPickerCard(card.id)} disabled={nlReadOnly} style={{ background: "rgba(0,0,0,0.65)", color: "white", border: "none", borderRadius: 4, padding: "0.2rem 0.5rem", fontFamily: FONT, fontSize: "0.7rem", cursor: nlReadOnly ? "default" : "pointer" }}>Change</button>
                              <button type="button" onClick={() => nlUpdateCard(card.id, { image: undefined })} disabled={nlReadOnly} style={{ background: "rgba(0,0,0,0.65)", color: "white", border: "none", borderRadius: 4, padding: "0.2rem 0.5rem", fontFamily: FONT, fontSize: "0.7rem", cursor: nlReadOnly ? "default" : "pointer" }}>Remove</button>
                            </div>
                            <input value={card.image.caption ?? ""} onChange={e => nlUpdateCard(card.id, { image: { ...card.image!, caption: straightenQuotes(e.target.value) } })}
                              placeholder="Add a caption…" readOnly={nlReadOnly}
                              style={{ fontFamily: FONT, fontSize: "0.7rem", color: TEXT_MUTED, fontStyle: "italic", border: "none", outline: "none", background: "transparent", width: "100%", padding: 0, margin: "0.4rem 0 0", boxSizing: "border-box", display: "block" }} />
                          </div>
                        ) : (
                          <button type="button" onClick={() => setNlImgPickerCard(card.id)} disabled={nlReadOnly} style={{ display: "block", width: "100%", margin: "0 0 1.75rem", background: "#ffffff", border: `2px dashed ${BORDER}`, color: TEXT_MUTED, fontFamily: FONT, fontSize: "0.85rem", padding: "3rem 0", cursor: nlReadOnly ? "default" : "pointer", opacity: nlReadOnly ? 0.6 : 1, textAlign: "center", boxSizing: "border-box" }}>
                            + Add a featured image
                          </button>
                        )}
                        <RichBodyEditor initialContent={card.doc} editable={!nlReadOnly} minHeight={60} 
                          onChange={doc => nlUpdateCard(card.id, { doc })}
                          onEditor={ed => { nlEditors.current[card.id] = ed; if (ed) setNlActiveEditor(prev => prev && !prev.isDestroyed ? prev : ed); }}
                          onToolbar={tb => { nlToolbars.current[card.id] = tb; }} />
                        {nlCardDraftRow(card, "left")}
                      </div>
                    )}

                    {/* MICRO-MEMOIR card — tweet-style social post (matches email) */}
                    {type === "micro-memoir" && (() => {
                      const mmInit = ((card.byline || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase()) || "GR";
                      return (
                      <div style={{ background: "#ffffff", padding: "1.25rem 1.4rem", border: `1px solid #b8b8ba`, borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.4)", margin: "0 0 1rem", textAlign: "left" }}>
                        {/* Header: avatar + name + subline */}
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.9rem" }}>
                          <div style={{ width: 44, height: 44, borderRadius: "50%", background: CRIMSON, color: "#fff", fontFamily: FONT, fontSize: "1rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{mmInit}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <input value={card.byline ?? ""} onChange={e => nlUpdateCard(card.id, { byline: e.target.value })} readOnly={nlReadOnly} placeholder="Author name"
                              style={{ fontFamily: FONT, fontSize: "0.95rem", fontWeight: 700, color: TEXT_DARK, lineHeight: 1.2, border: "none", outline: "none", width: "100%", background: "transparent", padding: 0, display: "block", boxSizing: "border-box" }} />
                            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginTop: 2 }}>
                              <input value={card.headline} onChange={e => nlUpdateCard(card.id, { headline: e.target.value })} readOnly={nlReadOnly} placeholder="Type your headline"
                                style={{ fontFamily: FONT, fontSize: "0.82rem", color: TEXT_MUTED, lineHeight: 1.2, border: "none", outline: "none", background: "transparent", padding: 0, boxSizing: "border-box", flexShrink: 1, minWidth: 0, width: `${Math.max((card.headline?.length || 10), 6)}ch` }} />
                              <span style={{ fontFamily: FONT, fontSize: "0.82rem", color: TEXT_MUTED, whiteSpace: "nowrap" }}>· {todayLabel}</span>
                            </div>
                          </div>
                        </div>
                        {/* Body */}
                        <div style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "1.1rem", lineHeight: 1.72 }}>
                          <RichBodyEditor initialContent={card.doc} editable={!nlReadOnly} minHeight={80} 
                            onChange={doc => nlUpdateCard(card.id, { doc })}
                            onEditor={ed => { nlEditors.current[card.id] = ed; if (ed) setNlActiveEditor(prev => prev && !prev.isDestroyed ? prev : ed); }}
                            onToolbar={tb => { nlToolbars.current[card.id] = tb; }} />
                        </div>
                        {/* Optional attached photo */}
                        {card.image ? (
                          <div style={{ margin: "0.9rem 0 0", position: "relative" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={sized(card.image.url, 700)} alt={card.image.alt ?? ""} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block", borderRadius: 12 }} />
                            <div className="nl-card-controls" style={{ position: "absolute", top: "0.4rem", right: "0.4rem", display: "flex", gap: "0.35rem" }}>
                              <button type="button" onClick={() => setNlImgPickerCard(card.id)} disabled={nlReadOnly} style={{ background: "rgba(0,0,0,0.65)", color: "white", border: "none", borderRadius: 4, padding: "0.2rem 0.5rem", fontFamily: FONT, fontSize: "0.7rem", cursor: nlReadOnly ? "default" : "pointer" }}>Change</button>
                              <button type="button" onClick={() => nlUpdateCard(card.id, { image: undefined })} disabled={nlReadOnly} style={{ background: "rgba(0,0,0,0.65)", color: "white", border: "none", borderRadius: 4, padding: "0.2rem 0.5rem", fontFamily: FONT, fontSize: "0.7rem", cursor: nlReadOnly ? "default" : "pointer" }}>Remove</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setNlImgPickerCard(card.id)} disabled={nlReadOnly} style={{ display: "block", width: "100%", margin: "0 0 1.75rem", background: "#ffffff", border: `2px dashed ${BORDER}`, color: TEXT_MUTED, fontFamily: FONT, fontSize: "0.85rem", padding: "3rem 0", cursor: nlReadOnly ? "default" : "pointer", opacity: nlReadOnly ? 0.6 : 1, textAlign: "center", boxSizing: "border-box" }}>
                            + Add a featured image
                          </button>
                        )}
                        {/* Footer meta */}
                        <div style={{ borderTop: `1px solid #b8b8ba`, marginTop: "1rem", paddingTop: "0.75rem", fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED }}>
                          {todayLabel} <span style={{ color: "#b8b8ba" }}>·</span> <span style={{ color: CRIMSON, fontWeight: 700 }}>A micro-memoir</span>
                        </div>
                        {nlCardDraftRow(card, "left")}
                      </div>
                      );
                    })()}

                    {/* ARCHIVE card — torn newspaper clipping reprint (matches email/reference) */}
                    {type === "archive" && (() => {
                      const c = archiveOrdinal % 2;
                      // Fixed-pixel amplitude, not percentage — a % clip-path makes
                      // a short blank card's tear subtle and a long photo+body
                      // card's tear an exaggerated sawtooth (same notch, radically
                      // different height to scale against), which also threw off
                      // the tape strips' fixed-pixel placement. Matches the email.
                      const torn = NL_TORN_CLIP_PATHS;
                      const taperot = NL_TAPE_ROTATIONS;
                      return (
                      <div style={{ background: "transparent", padding: "0.9rem 0.25rem 1.6rem", margin: "0 0 0.5rem" }}>
                        <div style={{ position: "relative", filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.5))" }}>
                          <div style={{ background: "#ffffff", clipPath: torn[c], padding: "2.1rem 1.75rem 2.5rem" }}>
                            <div style={{ borderBottom: `1px solid #000`, paddingBottom: "0.45rem", marginBottom: "1.1rem", fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.58rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "#000" }}>Gangrey · Archive &nbsp;·&nbsp; {fmtCardDate(card.date)}</div>
                            <input value={card.headline} onChange={e => nlUpdateCard(card.id, { headline: e.target.value })} readOnly={nlReadOnly} placeholder="Type your headline"
                              style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "1.9rem", fontWeight: 700, lineHeight: 1.15, color: TEXT_DARK, border: "none", outline: "none", width: "100%", background: "transparent", padding: 0, marginBottom: "0.5rem", display: "block", boxSizing: "border-box", textAlign: "left" }} />
                            <div style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.75rem", color: TEXT_MUTED, marginBottom: "1rem" }}>{nlBylineField(card, "left")}</div>
                            {card.image ? (
                              <div style={{ margin: "0 0 1rem", position: "relative" }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={sized(card.image.url, 700)} alt={card.image.alt ?? ""} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block", marginBottom: "0.25rem" }} />
                                {card.image.caption && <p style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.56rem", letterSpacing: "0.04em", textTransform: "uppercase", color: TEXT_MUTED, margin: 0 }}>{card.image.caption}</p>}
                                <div className="nl-card-controls" style={{ position: "absolute", top: "0.4rem", right: "0.4rem", display: "flex", gap: "0.35rem" }}>
                                  <button type="button" onClick={() => setNlImgPickerCard(card.id)} disabled={nlReadOnly} style={{ background: "rgba(0,0,0,0.65)", color: "white", border: "none", borderRadius: 4, padding: "0.2rem 0.5rem", fontFamily: FONT, fontSize: "0.7rem", cursor: nlReadOnly ? "default" : "pointer" }}>Change</button>
                                  <button type="button" onClick={() => nlUpdateCard(card.id, { image: undefined })} disabled={nlReadOnly} style={{ background: "rgba(0,0,0,0.65)", color: "white", border: "none", borderRadius: 4, padding: "0.2rem 0.5rem", fontFamily: FONT, fontSize: "0.7rem", cursor: nlReadOnly ? "default" : "pointer" }}>Remove</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setNlImgPickerCard(card.id)} disabled={nlReadOnly} style={{ display: "block", width: "100%", margin: "0 0 1.75rem", background: "#ffffff", border: `2px dashed ${BORDER}`, color: TEXT_MUTED, fontFamily: FONT, fontSize: "0.85rem", padding: "3rem 0", cursor: nlReadOnly ? "default" : "pointer", opacity: nlReadOnly ? 0.6 : 1, textAlign: "center", boxSizing: "border-box" }}>
                            + Add a featured image
                          </button>
                            )}
                            <div style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "1.1rem", lineHeight: 1.72, textAlign: "justify" }}>
                              <RichBodyEditor initialContent={card.doc} editable={!nlReadOnly} minHeight={80} 
                                onChange={doc => nlUpdateCard(card.id, { doc })}
                                onEditor={ed => { nlEditors.current[card.id] = ed; if (ed) setNlActiveEditor(prev => prev && !prev.isDestroyed ? prev : ed); }}
                                onToolbar={tb => { nlToolbars.current[card.id] = tb; }} />
                            </div>
                            {nlCardDraftRow(card, "left")}
                          </div>
                          {/* Tape strips */}
                          <div style={{ position: "absolute", top: -11, left: 40, width: 92, height: 22, background: "rgba(233,230,225,0.5)", transform: `rotate(${taperot[c][0]})`, boxShadow: "0 1px 3px rgba(0,0,0,0.18)" }} />
                          <div style={{ position: "absolute", top: -11, right: 40, width: 92, height: 22, background: "rgba(233,230,225,0.5)", transform: `rotate(${taperot[c][1]})`, boxShadow: "0 1px 3px rgba(0,0,0,0.18)" }} />
                        </div>
                      </div>
                      );
                    })()}
                  </>)}
                  </div>
                </div>
              );
            }); })()}

            {/* Add zone after last card */}
            <div className="nl-add-zone" onClick={() => { if (!nlReadOnly) nlAddCardAfter(nlCards.length - 1); }}
              style={{ display: "flex", alignItems: "center", gap: "0.6rem", height: 24, cursor: nlReadOnly ? "default" : "pointer", visibility: nlReadOnly ? "hidden" : "visible", marginTop: "0.5rem" }}>
              <div className="nl-add-line" style={{ flex: 1, height: 1, background: "#ddd" }} />
              <span className="nl-add-label" style={{ fontFamily: FONT, fontSize: "0.7rem", color: TEXT_MUTED, whiteSpace: "nowrap", padding: "0 0.3rem" }}>+ Add section</span>
              <div className="nl-add-line" style={{ flex: 1, height: 1, background: "#ddd" }} />
            </div>
          </div>

          {/* Member callout — matches the email exactly; shown on every sent issue */}
          <div style={{ background: "#000000", padding: "0 1rem 1rem" }}>
            <div style={{ border: `1px solid #b8b8ba`, padding: "1.75rem 2.1rem", textAlign: "center" }}>
              <p style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "1.25rem", lineHeight: 1.3, color: "#ffffff", margin: "0 0 0.6rem" }}>Keep reading with a membership</p>
              <p style={{ fontFamily: "var(--font-cormorant), Georgia, serif", fontSize: "0.88rem", lineHeight: 1.5, color: "#b8b8ba", margin: "0 auto 1.25rem", maxWidth: 340 }}>Join to read every story in full, unlock the archive, and support narrative nonfiction.</p>
              <span style={{ display: "inline-block", background: CRIMSON, color: "#ffffff", padding: "0.75rem 1.6rem", fontFamily: FONT, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>Become a Member</span>
            </div>
          </div>

          {/* Footer — plain black panel (matches email/reference) */}
          <div style={{ background: "#000000", padding: "24px 34px", textAlign: "center" }}>
            <p style={{ fontFamily: FONT, fontSize: "0.62rem", lineHeight: 1.7, color: "#b8b8ba", letterSpacing: "0.14em", textTransform: "uppercase", margin: "0 0 0.6rem" }}>You&apos;re receiving this because you subscribed to Gangrey</p>
            <span style={{ fontFamily: FONT, fontSize: "0.62rem", fontWeight: 700, color: "#ffffff", letterSpacing: "0.18em", textTransform: "uppercase", borderBottom: `1px solid ${CRIMSON}`, paddingBottom: 2 }}>Unsubscribe</span>
          </div>
        </div>

        {/* Newsletter metadata — sits below the page */}
        <div style={{ maxWidth: 600, margin: "2rem auto 0" }}>
          <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <h3 style={{ fontFamily: FONT, fontSize: "1rem", fontWeight: 700, color: TEXT_DARK, margin: 0 }}>Newsletter info</h3>
            {/* Classics issues carry no Volume, Issue, or Guest Editor — the cover
                shows only today's date. So only Subject/Preview apply below. */}
            {!nlClassics && (
              <>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontFamily: FONT, fontSize: "0.75rem", fontWeight: 600, color: TEXT_MUTED, display: "block", marginBottom: "0.3rem" }}>Volume</label>
                    <input value={nlVolume} onChange={e => setNlVolume(e.target.value)} readOnly={nlReadOnly} placeholder="1" style={INPUT} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontFamily: FONT, fontSize: "0.75rem", fontWeight: 600, color: TEXT_MUTED, display: "block", marginBottom: "0.3rem" }}>Issue</label>
                    <input value={nlIssue} onChange={e => setNlIssue(e.target.value)} readOnly={nlReadOnly} placeholder="1" style={INPUT} />
                  </div>
                </div>
                <div>
                  <label style={{ fontFamily: FONT, fontSize: "0.75rem", fontWeight: 600, color: TEXT_MUTED, display: "block", marginBottom: "0.3rem" }}>Guest Editor</label>
                  <input value={nlAuthor} onChange={e => setNlAuthor(straightenQuotes(e.target.value))} readOnly={nlReadOnly} style={INPUT} />
                </div>
              </>
            )}
            <div>
              <label style={{ fontFamily: FONT, fontSize: "0.75rem", fontWeight: 600, color: TEXT_MUTED, display: "block", marginBottom: "0.3rem" }}>Copy editor</label>
              <select value={nlCopyEditor} onChange={e => setNlCopyEditor(e.target.value)} disabled={nlReadOnly} style={INPUT}>
                <option value="">— Unassigned —</option>
                {Array.from(new Set([...(nlCopyEditor ? [nlCopyEditor] : []), ...editors])).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontFamily: FONT, fontSize: "0.75rem", fontWeight: 600, color: TEXT_MUTED, display: "block", marginBottom: "0.3rem" }}>Subject line<span style={{ color: CRIMSON }}>*</span></label>
              <input value={nlSubject} onChange={e => setNlSubject(straightenQuotes(e.target.value))} readOnly={nlReadOnly} placeholder="Add a subject line" style={INPUT} />
            </div>
            <div>
              <label style={{ fontFamily: FONT, fontSize: "0.75rem", fontWeight: 600, color: TEXT_MUTED, display: "block", marginBottom: "0.3rem" }}>Preview text</label>
              <input value={nlPreview} onChange={e => setNlPreview(straightenQuotes(e.target.value))} readOnly={nlReadOnly} placeholder="Add preview text" style={INPUT} />
            </div>
          </div>

          {/* Divider + Previous versions — matches story editor's list */}
          <hr style={{ border: "none", borderTop: `1px solid ${BORDER}`, margin: "1rem 0 0.5rem" }} />
          <div>
            <h3 style={{ fontFamily: FONT, fontSize: "1rem", fontWeight: 700, color: TEXT_DARK, margin: "0 0 0.35rem" }}>Previous versions</h3>
            {initial?.lastEditedBy && initial?.lastEditedAt && (
              <p style={{ fontFamily: FONT, fontSize: "0.78rem", color: TEXT_MUTED, margin: "0 0 1rem" }}>
                Edited by {initial.lastEditedBy} · {relativeTime(initial.lastEditedAt)}
              </p>
            )}
            {nlVersions.length === 0 ? (
              <p style={{ fontFamily: FONT, fontSize: "0.88rem", color: TEXT_MUTED }}>No saves recorded yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {(() => {
                  let lastDay = "";
                  return nlVersions.map((v, i) => {
                    const day = dayLabel(v.createdAt);
                    const showHeading = day !== lastDay;
                    lastDay = day;
                    const editor = v.editedBy || v.author || "Unknown";
                    return (
                      <div key={v.id}>
                        {showHeading && (
                          <p style={{ fontFamily: FONT, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TEXT_MUTED, margin: i === 0 ? "0 0 0.5rem" : "1.25rem 0 0.5rem" }}>
                            {day}
                          </p>
                        )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0", borderBottom: `1px solid ${BORDER}`, gap: "0.75rem" }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontFamily: FONT, fontSize: "0.85rem", fontWeight: 600, color: TEXT_DARK, margin: 0 }}>{formatVersionTime(v.createdAt)}</p>
                      <p style={{ fontFamily: FONT, fontSize: "0.75rem", color: TEXT_MUTED, margin: "0.25rem 0 0", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorForName(editor), flexShrink: 0, display: "inline-block" }} />
                        {editor}
                        <span style={{ opacity: 0.6 }}>
                          · {v.type === "publish" ? "Published" : "Auto-saved"}{v.wordCount ? ` · ${v.wordCount} words` : ""}
                        </span>
                      </p>
                    </div>
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <button type="button" onClick={() => setNlVersionMenu(nlVersionMenu === v.id ? null : v.id)}
                        style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 20, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: TEXT_MUTED }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
                      </button>
                      {nlVersionMenu === v.id && (
                        <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 50, background: "white", border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 160, overflow: "hidden" }}>
                          <button type="button" onClick={() => { setNlVersionMenu(null); setNlCompare(v.id); }}
                            style={{ display: "block", width: "100%", background: "none", border: "none", borderBottom: `1px solid ${BORDER}`, textAlign: "left", padding: "0.6rem 1rem", fontFamily: FONT, fontSize: "0.85rem", color: TEXT_DARK, cursor: "pointer" }}>
                            Compare changes
                          </button>
                          <button type="button" onClick={() => { setNlVersionMenu(null); restoreNlVersion(v); }}
                            style={{ display: "block", width: "100%", background: "none", border: "none", textAlign: "left", padding: "0.6rem 1rem", fontFamily: FONT, fontSize: "0.85rem", color: TEXT_DARK, cursor: "pointer" }}>
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
        </div>
      </div>

      {/* Version compare — Google-Docs-style inline redline */}
      {nlCompare && nlVersions.find(v => v.id === nlCompare) && (() => {
        const v = nlVersions.find(x => x.id === nlCompare)!;
        const oldLines = [v.subject ?? "", v.preview ?? "", ...((v.cards ?? []) as StoredCard[]).flatMap(c => [c.headline ?? "", ...portableToLines(c.body)])].map(s => (s ?? "").trim()).filter(Boolean);
        // Serialize live cards through the same tiptap → portable-text pipeline
        // the snapshot used, so unchanged content doesn't show as a diff.
        const newLines = [nlSubject, nlPreview, ...nlCards.flatMap(c => [c.headline, ...portableToLines(tiptapToPortableText(c.doc))])].map(s => (s ?? "").trim()).filter(Boolean);
        return (
          <VersionCompare
            label={formatVersionTime(v.createdAt)}
            oldLines={oldLines}
            newLines={newLines}
            onRestore={() => { setNlCompare(null); restoreNlVersion(v); }}
            onClose={() => setNlCompare(null)}
            isMobile={isMobile}
          />
        );
      })()}
    </div>
  );
}
