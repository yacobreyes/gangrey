// Renders newsletter cards (portable text) into a self-contained HTML email.
// Kept dependency-free: a small serializer for the block types our editor emits.
//
// This markup mirrors, element-for-element, the approved design reference
// ("Newsletter Redesign" — the black-ground option): a 600px email on solid
// black, floating white article sheets, tweet-style micro-memoirs, and torn
// newspaper-clipping archive cards. Only the grayscale photo filter from the
// reference is intentionally dropped (the editor asked for full-color archive
// photos).
import type { PortableTextBlock } from "@portabletext/types";
import { straightenQuotes, straightenBlocks } from "./straighten";
import { CRIMSON } from "./palette";
import {
  NL_FONT as FONT, NL_SERIF as SERIF, NL_GROUND as GROUND, NL_PAPER as PAPER,
  NL_EARTH as EARTH, NL_RULE as RULE, NL_TAPE as TAPE,
  NL_HEAD_SIZE_PX as HEAD_SIZE, NL_HEAD_LINE as HEAD_LINE,
  NL_TORN_CLIP_PATHS as TORN, NL_TAPE_ROTATIONS as TAPE_ROT,
} from "./newsletterTokens";

export type NlCard = {
  headline?: string;
  deck?: string;
  body?: PortableTextBlock[];
  image?: { url?: string; caption?: string; alt?: string } | null;
  cardType?: "narratives" | "essays" | "micro-memoir" | "archive" | "feature" | "standard" | "digest";
  byline?: string;
  // Original publish date of the source story (ISO). Used for the "Gangrey ·
  // Archive · <date>" running head on archive clippings so it reflects when the
  // piece actually ran, not when the newsletter is sent.
  date?: string;
};

// Typography/palette/torn-clip tokens are imported from ./newsletterTokens —
// shared with the editor canvas so the two can't silently drift apart again.
// (Astoria is deliberately NOT used in the email: mail clients, Gmail
// especially, render its straight apostrophe/quote glyphs as curls.)

// Canonical public host for email links (wordmark image, unsubscribe).
const SITE_URL = "https://gangrey.org";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type Span = { text?: string; marks?: string[] };
type MarkDef = { _key: string; _type: string; href?: string };

function renderSpans(spans: Span[], markDefs: MarkDef[]): string {
  return spans
    .map(span => {
      let html = esc(span.text ?? "");
      for (const m of span.marks ?? []) {
        if (m === "strong") html = `<strong>${html}</strong>`;
        else if (m === "em") html = `<em>${html}</em>`;
        else {
          const def = markDefs.find(d => d._key === m);
          if (def?._type === "link" && def.href) html = `<a href="${esc(def.href)}" style="color:${CRIMSON};">${html}</a>`;
        }
      }
      return html;
    })
    .join("");
}

type BodyStyle = { size: number; line: number; align: "left" | "justify" };
// One body size/line-height/font used everywhere — only the paragraph
// alignment varies by card type (archive keeps justified for the newspaper
// feel). Headlines share the same size/line-height across all card types too.
const SHEET_BODY: BodyStyle = { size: 18, line: 1.72, align: "left" };
const MICRO_BODY: BodyStyle = { size: 18, line: 1.72, align: "left" };
const CLIP_BODY: BodyStyle = { size: 18, line: 1.72, align: "justify" };

function renderBody(blocks: PortableTextBlock[], bs: BodyStyle = SHEET_BODY): string {
  const P = `font-family:${SERIF};font-size:${bs.size}px;line-height:${bs.line};color:${GROUND};text-align:${bs.align};margin:0 0 14px;`;
  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i] as PortableTextBlock & { style?: string; listItem?: string; markDefs?: MarkDef[]; children?: Span[]; src?: string; alt?: string };

    if (b._type === "imageEmbed") {
      out.push(`<img src="${esc(b.src ?? "")}" alt="${esc(b.alt ?? "")}" style="width:100%;border-radius:6px;margin:0 0 16px;" />`);
      i++; continue;
    }
    if (b._type !== "block") { i++; continue; }

    const spans = (b.children ?? []) as Span[];
    const inline = renderSpans(spans, b.markDefs ?? []);
    const style = b.style ?? "normal";

    if (b.listItem === "bullet" || b.listItem === "number") {
      const tag = b.listItem === "bullet" ? "ul" : "ol";
      const items: string[] = [];
      while (i < blocks.length) {
        const bi = blocks[i] as PortableTextBlock & { listItem?: string; children?: Span[]; markDefs?: MarkDef[] };
        if (bi._type !== "block" || bi.listItem !== b.listItem) break;
        items.push(`<li style="margin:0 0 6px;">${renderSpans((bi.children ?? []) as Span[], bi.markDefs ?? [])}</li>`);
        i++;
      }
      out.push(`<${tag} style="font-family:${SERIF};font-size:${bs.size}px;line-height:${bs.line};color:${GROUND};margin:0 0 14px;padding-left:22px;">${items.join("")}</${tag}>`);
      continue;
    }

    if (style === "h2") out.push(`<h2 style="font-family:${SERIF};font-size:24px;font-weight:700;color:${GROUND};margin:28px 0 6px;">${inline}</h2>`);
    else if (style === "blockquote") out.push(`<blockquote style="border-left:3px solid ${CRIMSON};margin:16px 0;padding:2px 0 2px 16px;font-style:italic;color:${EARTH};font-family:${SERIF};font-size:${bs.size}px;">${inline}</blockquote>`);
    else out.push(`<p style="${P}">${inline}</p>`);
    i++;
  }
  return out.join("");
}

function effectiveType(card: NlCard, idx: number): "narratives" | "essays" | "micro-memoir" | "archive" {
  const t = card.cardType;
  if (t === "narratives" || t === "feature") return "narratives";
  if (t === "essays" || t === "standard") return "essays";
  if (t === "micro-memoir" || t === "digest") return "micro-memoir";
  if (t === "archive") return "archive";
  if (idx === 0) return "narratives";
  return "essays";
}

function initials(name?: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "GR";
  return (words[0][0] + (words[1]?.[0] ?? "")).toUpperCase();
}

// Irregular torn top/bottom edges for the archive clippings. Amplitude is
// fixed in PIXELS (not percent) so the tear looks the same regardless of how
// tall the card is — a percentage-based clip-path made a short blank card's
// tear subtle and a long photo+body card's tear an exaggerated sawtooth (the
// same 1-2% notch is a couple of px on a short card, a dozen+ px on a tall
// one), which also threw off the tape strips' fixed-pixel placement.

type NlOpts = { subject: string; preview: string; intro?: string; author?: string; volume?: string; issue?: string; cards: NlCard[]; baseUrl?: string; viewOnlineUrl?: string; classics?: boolean };

// Single source of truth — produces the exact markup the admin editor canvas
// renders. Both the web reader (/issues/[slug]) and the email reuse this so the
// preview, the sent email, and the editor all look identical. The only knob is
// whether to include the wordmark cover masthead (the web reader omits it
// because MagHeader already shows the wordmark above it).
function renderNewsletterContent(raw: NlOpts, opts: { masthead: boolean; web?: boolean }): string {
  // The web reader keeps the black ground BETWEEN cards but drops the 16px
  // side gutters so the white sheets bleed to the column edge (the page adds
  // an edge shadow around the whole 600px column instead). The email keeps
  // gutters on all sides.
  const gx = opts.web ? "0" : "16px";
  const intro = raw.intro ? straightenQuotes(raw.intro) : raw.intro;
  const author = raw.author ? straightenQuotes(raw.author) : raw.author;
  const subject = raw.subject ? straightenQuotes(raw.subject) : raw.subject;
  const { volume, issue } = raw;
  const base = (raw.baseUrl ?? SITE_URL).replace(/\/$/, "");
  // Card image URLs are stored relative ("/media/...") since they're written
  // by the in-app picker. That resolves fine on gangrey.org, but a mail client
  // has no page to resolve against, so relative photos silently fail to load —
  // every image src sent in the email must be absolute.
  const absUrl = (url?: string) => (url && url.startsWith("/") ? `${base}${url}` : url ?? "");
  // The picker stores the RAW upload path with no resize params, so cards were
  // shipping original multi-MB photos into a 600px column — the source of slow
  // image loads in both the email and the web reader. Request the 1200×675
  // derivative instead (matches the 16:9 card crop; pre-generated on publish
  // by warmImageDerivatives, so it's a warm cache hit).
  const imgSrc = (url?: string) => {
    const abs = absUrl(url);
    if (!abs.includes("/media/") || abs.includes("w=")) return abs;
    return `${abs}${abs.includes("?") ? "&" : "?"}w=1200&h=675`;
  };
  const cards = raw.cards.map(c => ({
    ...c,
    headline: c.headline ? straightenQuotes(c.headline) : c.headline,
    deck: c.deck ? straightenQuotes(c.deck) : c.deck,
    byline: c.byline ? straightenQuotes(c.byline) : c.byline,
    body: c.body ? straightenBlocks(c.body) : c.body,
    image: c.image ? { ...c.image, caption: c.image.caption ? straightenQuotes(c.image.caption) : c.image.caption } : c.image,
  }));
  const shortDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  // Format a story's ISO publish date as "Month D, YYYY"; fall back to today
  // only when a card carries no date (shouldn't happen for imported archive
  // pieces, which always have one).
  const fmtDate = (iso?: string) => {
    if (!iso) return shortDate;
    const d = new Date(iso);
    return isNaN(+d) ? shortDate : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  };

  // Kicker + 40×2 crimson rule (grey on the black ground). center aligns both.
  const kicker = (name: string, onDark: boolean, center: boolean) => {
    const color = onDark ? RULE : CRIMSON;
    const c = center ? "text-align:center;" : "";
    const rc = center ? "margin:0 auto 22px;" : "margin-bottom:22px;";
    return `<div style="font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${color};${c}margin-bottom:10px;">${esc(name)}</div>`
      + `<div style="width:40px;height:2px;background:${CRIMSON};${rc}"></div>`;
  };

  let archiveN = 0;

  const cardsHtml = cards.map((card, idx) => {
    const type = effectiveType(card, idx);
    const alignC = (center: boolean) => (center ? "text-align:center;" : "");

    // ---- ESSAYS / NARRATIVES: white sheet ----
    if (type === "essays" || type === "narratives") {
      const center = type === "narratives";
      const deck = card.deck
        ? `<p style="font-family:${SERIF};font-size:20px;line-height:1.45;color:${EARTH};${alignC(center)}margin:0${center ? " auto" : ""} 20px;${center ? "max-width:440px;" : ""}">${esc(card.deck)}</p>`
        : "";
      const byline = card.byline
        ? `<p style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${EARTH};${alignC(center)}margin:0 0 24px;">By ${esc(card.byline)}</p>`
        : "";
      const img = card.image?.url
        ? `<img src="${imgSrc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;margin-bottom:8px;" />`
          + (card.image.caption ? `<p style="font-family:${FONT};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${EARTH};margin:0 0 24px;">${esc(card.image.caption)}</p>` : `<div style="height:16px;"></div>`)
        : "";
      return `<div style="padding:0 ${gx} 16px;">
        <div style="background:${PAPER};padding:36px 34px 34px;">
          ${kicker(center ? "Narratives" : "Essays", false, center)}
          <h1 style="font-family:${SERIF};font-size:${HEAD_SIZE}px;font-weight:700;line-height:${HEAD_LINE};color:${GROUND};${alignC(center)}margin:0 0 16px;">${esc(card.headline ?? "")}</h1>
          ${deck}
          ${byline}
          ${img}
          <div style="${alignC(false)}">${renderBody(card.body ?? [])}</div>
        </div>
      </div>`;
    }

    // ---- MICRO-MEMOIR: tweet card on the black ground ----
    if (type === "micro-memoir") {
      const img = card.image?.url
        ? `<img src="${imgSrc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;border-radius:12px;margin-bottom:16px;" />`
        : "";
      return `<div style="padding:0 ${gx} 16px;">
        <div style="background:transparent;padding:22px 16px 26px;">
          ${kicker("Micro-Memoir", true, false)}
          <div style="background:${PAPER};border:1px solid ${RULE};border-radius:16px;padding:20px 22px;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;"><tr>
              <td width="48" valign="top" style="width:48px;">
                <div style="width:44px;height:44px;border-radius:50%;background:${CRIMSON};color:#ffffff;font-family:${FONT};font-size:16px;font-weight:700;text-align:center;line-height:44px;">${initials(card.byline)}</div>
              </td>
              <td valign="middle" style="padding-left:12px;">
                <div style="font-family:${FONT};font-size:15px;font-weight:700;color:${GROUND};line-height:1.2;">${esc(card.byline ?? "Gangrey")}</div>
                <div style="font-family:${FONT};font-size:13px;color:${EARTH};line-height:1.2;margin-top:2px;">${esc(card.headline ?? "")} · ${shortDate}</div>
              </td>
            </tr></table>
            <div>${renderBody(card.body ?? [], MICRO_BODY)}</div>
            ${img}
            <div style="font-family:${FONT};font-size:12px;color:${EARTH};border-top:1px solid ${RULE};padding-top:12px;">
              <span>${esc(shortDate)}</span>
              <span style="color:${RULE};">&nbsp;·&nbsp;</span>
              <span style="color:${CRIMSON};font-weight:700;">A micro-memoir</span>
            </div>
          </div>
        </div>
      </div>`;
    }

    // ---- GANGREY CLASSICS / ARCHIVE: torn newspaper clipping on black ----
    const c = archiveN % 2;
    archiveN++;
    const img = card.image?.url
      ? `<img src="${imgSrc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;margin-bottom:4px;" />`
        + (card.image.caption ? `<p style="font-family:${SERIF};font-size:9px;letter-spacing:0.04em;text-transform:uppercase;color:${EARTH};margin:0 0 16px;">${esc(card.image.caption)}</p>` : `<div style="height:16px;"></div>`)
      : "";
    return `<div style="padding:0 ${gx} 16px;">
      <div style="background:transparent;padding:26px 4px;">
        <div style="position:relative;${opts.web ? "" : "filter:drop-shadow(0 8px 16px rgba(0,0,0,0.5));"}">
          <div style="background:${PAPER};clip-path:${TORN[c]};padding:34px 28px 40px;">
            <div style="border-bottom:1px solid ${GROUND};padding-bottom:7px;margin-bottom:18px;font-family:${SERIF};font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:${GROUND};">Gangrey · Archive &nbsp;·&nbsp; ${esc(fmtDate(card.date))}</div>
            <h2 style="font-family:${SERIF};font-size:${HEAD_SIZE}px;font-weight:700;line-height:${HEAD_LINE};color:${GROUND};text-align:left;margin:0 0 8px;">${esc(card.headline ?? "")}</h2>
            ${card.byline ? `<p style="font-family:${SERIF};font-size:12px;letter-spacing:0.02em;color:${EARTH};text-align:left;margin:0 0 16px;">By ${esc(card.byline)}</p>` : ""}
            ${img}
            <div>${renderBody(card.body ?? [], CLIP_BODY)}</div>
          </div>
          <div style="position:absolute;top:-11px;left:40px;width:92px;height:22px;background:${TAPE};transform:rotate(${TAPE_ROT[c][0]});box-shadow:0 1px 3px rgba(0,0,0,0.18);"></div>
          <div style="position:absolute;top:-11px;right:40px;width:92px;height:22px;background:${TAPE};transform:rotate(${TAPE_ROT[c][1]});box-shadow:0 1px 3px rgba(0,0,0,0.18);"></div>
        </div>
      </div>
    </div>`;
  }).join("");

  // ---- COVER (masthead) ----
  const cover = opts.masthead
    ? `<div style="background:${GROUND};padding:16px;">
        <div style="border:1px solid ${RULE};padding:26px 34px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;"><tr>
            <td align="left" style="font-family:${FONT};font-size:9px;letter-spacing:0.28em;text-transform:uppercase;color:${RULE};">A Literary Magazine</td>
            <td align="right" style="font-family:${FONT};font-size:9px;letter-spacing:0.28em;text-transform:uppercase;color:${RULE};">gangrey.org</td>
          </tr></table>
          <a href="${SITE_URL}" target="_blank" rel="noopener" style="text-decoration:none;">
            ${raw.classics
              ? `<img src="${base}/wordmark-classics-email.png" alt="Gangrey Classics" width="290" style="width:290px;max-width:80%;display:block;margin:0 auto 20px;border:0;" />`
              : `<img src="${base}/wordmark-white-email.png" alt="Gangrey" width="290" height="106" style="width:290px;height:106px;max-width:80%;display:block;margin:0 auto 20px;border:0;" />`
            }
          </a>
          <div style="width:40px;height:2px;background:${CRIMSON};margin:0 auto 20px;"></div>
          ${subject ? `<p style="font-family:${SERIF};font-size:22px;line-height:1.3;color:#ffffff;text-align:center;margin:0 0 8px;">${esc(subject)}</p>` : ""}
          ${intro ? `<p style="font-family:${SERIF};font-size:15px;line-height:1.6;color:${RULE};text-align:center;max-width:440px;margin:0 auto 16px;white-space:pre-line;">${esc(intro)}</p>` : ""}
          ${!raw.classics && author ? `<p style="font-family:${FONT};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${RULE};text-align:center;margin:0 0 24px;">Guest Editor · <span style="color:#ffffff;">${esc(author)}</span></p>` : `<div style="height:8px;"></div>`}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${RULE};"><tr>
            <td align="left" style="padding-top:16px;font-family:${FONT};font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#ffffff;">Est. 2026</td>
            <td align="right" style="padding-top:16px;font-family:${SERIF};font-size:11px;letter-spacing:0.06em;color:#ffffff;">${raw.classics
              ? esc(shortDate)
              : `${volume ? `<span style="color:${RULE};">Vol.</span> ${esc(volume)}` : ""}${volume && issue ? " &nbsp; " : ""}${issue ? `<span style="color:${RULE};">No.</span> ${esc(issue)}` : ""}`
            }</td>
          </tr></table>
        </div>
      </div>`
    : "";

  return `${cover}<div style="background:${GROUND};">${cardsHtml}</div>`;
}

// The full newsletter sheet — content + unsubscribe footer. The cover masthead
// (wordmark) is included only in the email; the web reader omits it because the
// site's MagHeader already shows the wordmark (avoids a double header).
function renderNewsletterSheet(opts: NlOpts, includeMasthead: boolean, web = false): string {
  // "View in browser" — only meaningful for the emailed copy (the web reader
  // is already the browser view). Sits in a slim strip above the cover.
  const viewOnline = includeMasthead && opts.viewOnlineUrl
    ? `<div style="background:${GROUND};padding:10px 16px 0;text-align:center;">
        <a href="${opts.viewOnlineUrl}" target="_blank" rel="noopener" style="font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${RULE};text-decoration:none;">View in browser</a>
      </div>`
    : "";
  // Member callout — a black panel promoting membership, shown above the
  // unsubscribe footer on every issue (free content is the hook; this is the ask).
  const memberCallout = `<div style="background:${GROUND};padding:0 16px 16px;">
    <div style="background:${GROUND};border:1px solid ${RULE};padding:28px 34px;text-align:center;">
      <p style="font-family:${SERIF};font-size:20px;line-height:1.3;color:#ffffff;margin:0 0 10px;">Keep reading with a membership</p>
      <p style="font-family:${SERIF};font-size:14px;line-height:1.5;color:${RULE};margin:0 auto 20px;max-width:380px;">Join to read every story in full, unlock the archive, and support narrative nonfiction.</p>
      <a href="${SITE_URL}/subscribe" target="_blank" rel="noopener" style="display:inline-block;background:${CRIMSON};color:#ffffff;text-decoration:none;padding:12px 26px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Become a Member</a>
    </div>
  </div>`;
  return `<div style="width:100%;max-width:600px;margin:0 auto;background:${GROUND};">
    ${viewOnline}
    ${renderNewsletterContent(opts, { masthead: includeMasthead, web })}
    ${memberCallout}
    <div style="background:${GROUND};padding:24px 34px;text-align:center;">
      <p style="font-family:${FONT};font-size:10px;line-height:1.7;letter-spacing:0.14em;text-transform:uppercase;color:${RULE};margin:0 0 10px;">You're receiving this because you subscribed to Gangrey</p>
      <a href="${SITE_URL}/unsubscribe" target="_blank" rel="noopener" style="font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;text-decoration:none;border-bottom:1px solid ${CRIMSON};padding-bottom:2px;">Unsubscribe</a>
    </div>
  </div>`;
}

// Web reader version — used on /issues/[slug]. No wordmark masthead (MagHeader
// already shows it), so the on-site render isn't double-headed.
export function renderNewsletterPageHtml(opts: NlOpts): string {
  return renderNewsletterSheet(opts, false, true);
}

// Email version — same sheet, wrapped with the email document shell (preview
// text, light color-scheme lock).
export function renderNewsletterHtml(opts: NlOpts): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
</style></head>
<body style="margin:0;padding:0;background:${GROUND};">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preview)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;border-collapse:collapse;background:${GROUND};">
    <tr><td align="center" style="padding:0;">
      ${renderNewsletterSheet(opts, true)}
    </td></tr>
  </table>
</body></html>`;
}
