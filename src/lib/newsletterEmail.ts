// Renders newsletter cards (portable text) into a self-contained HTML email.
// Kept dependency-free: a small serializer for the block types our editor emits.
import type { PortableTextBlock } from "@portabletext/types";
import { straightenQuotes, straightenBlocks } from "./straighten";
import { CRIMSON, INK, TEXT_MUTED, LINE } from "./palette";

export type NlCard = {
  headline?: string;
  body?: PortableTextBlock[];
  image?: { url?: string; caption?: string; alt?: string } | null;
  cardType?: "narratives" | "essays" | "micro-memoir" | "archive" | "feature" | "standard" | "digest";
  byline?: string;
};

// Email + web-reader typography. Astoria is deliberately NOT used here: mail
// clients (Gmail especially) load Astoria but render its straight apostrophe/
// quote glyphs as curls, and they strip the @font-face unicode-range override
// that fixes that on the website. Georgia/system fonts draw straight quotes
// everywhere. The brand is carried by the wordmark image in the masthead.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

// The redesign sits the whole issue on solid black. White article "sheets"
// float on this ground (a 16px black gutter around each), the cover and footer
// are black panels with a hairline keyline, and micro-memoirs / archive
// clippings sit directly on the black with no sheet.
const GROUND = "#000000";
const PAPER = "#ffffff";
const TAPE = "rgba(233,230,225,0.5)";

// Email clients (and the preview iframe) can't load a relative path, so the
// masthead image needs an absolute URL. Canonical public host for email links
// (wordmark image, unsubscribe). Hardcoded to production rather than read from
// NEXT_PUBLIC_SITE_URL, which has historically pointed at the dead old project.
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
const SHEET_BODY: BodyStyle = { size: 18, line: 1.72, align: "left" };
const CLIP_BODY: BodyStyle = { size: 14, line: 1.62, align: "justify" };

function renderBody(blocks: PortableTextBlock[], bs: BodyStyle = SHEET_BODY): string {
  const P = `font-family:${SERIF};font-size:${bs.size}px;line-height:${bs.line};color:${INK};text-align:${bs.align};margin:0 0 16px;`;
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
      out.push(`<${tag} style="font-family:${SERIF};font-size:${bs.size}px;line-height:${bs.line};color:${INK};margin:0 0 16px;padding-left:22px;">${items.join("")}</${tag}>`);
      continue;
    }

    if (style === "h2") out.push(`<h2 style="font-family:${SERIF};font-size:24px;font-weight:700;color:${INK};margin:28px 0 6px;">${inline}</h2>`);
    else if (style === "blockquote") out.push(`<blockquote style="border-left:3px solid ${CRIMSON};margin:16px 0;padding:2px 0 2px 16px;font-style:italic;color:${TEXT_MUTED};font-family:${SERIF};font-size:${bs.size}px;">${inline}</blockquote>`);
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

// Irregular torn top/bottom edges for the archive clippings — hand-tuned
// polygons (straight left/right, uneven notches top and bottom). Alternated so
// the two clippings don't look identical.
const TORN = [
  "polygon(0% 1.6%,6% 0.5%,12% 2.1%,18% 0.8%,24% 1.7%,31% 0.4%,38% 2.3%,45% 1.0%,52% 0.6%,59% 2.0%,66% 0.9%,73% 1.8%,80% 0.5%,87% 2.2%,94% 1.0%,100% 0.8%,100% 99.2%,94% 98.6%,87% 99.4%,80% 98.5%,73% 99.3%,66% 98.4%,59% 99.4%,52% 98.7%,45% 99.3%,38% 98.4%,31% 99.2%,24% 98.6%,18% 99.4%,12% 98.6%,6% 99.3%,0% 98.8%)",
  "polygon(0% 1.2%,7% 0.4%,13% 2.0%,19% 0.7%,26% 1.9%,33% 0.5%,39% 2.2%,46% 0.9%,53% 0.5%,60% 2.1%,67% 0.8%,74% 1.7%,81% 0.6%,88% 2.0%,95% 0.9%,100% 1.4%,100% 98.8%,95% 99.3%,88% 98.5%,81% 99.4%,74% 98.6%,67% 99.2%,60% 98.4%,53% 99.4%,46% 98.7%,39% 99.3%,33% 98.5%,26% 99.2%,19% 98.6%,13% 99.4%,7% 98.7%,0% 99.2%)",
];
const TILT = ["-1.1deg", "0.9deg"];

type NlOpts = { subject: string; preview: string; intro?: string; author?: string; volume?: string; issue?: string; cards: NlCard[]; baseUrl?: string };

// Single source of truth — produces the exact markup the admin editor canvas
// renders. Both the web reader (/issues/[slug]) and the email reuse this so the
// preview, the sent email, and the editor all look identical. The only knob is
// whether to include the wordmark cover masthead (the web reader omits it
// because MagHeader already shows the wordmark above it).
function renderNewsletterContent(raw: NlOpts, opts: { masthead: boolean }): string {
  // Enforce straight quotes across all newsletter text (matches site house style).
  const intro = raw.intro ? straightenQuotes(raw.intro) : raw.intro;
  const author = raw.author ? straightenQuotes(raw.author) : raw.author;
  const subject = raw.subject ? straightenQuotes(raw.subject) : raw.subject;
  const { volume, issue } = raw;
  const base = (raw.baseUrl ?? SITE_URL).replace(/\/$/, "");
  const cards = raw.cards.map(c => ({
    ...c,
    headline: c.headline ? straightenQuotes(c.headline) : c.headline,
    byline: c.byline ? straightenQuotes(c.byline) : c.byline,
    body: c.body ? straightenBlocks(c.body) : c.body,
    image: c.image ? { ...c.image, caption: c.image.caption ? straightenQuotes(c.image.caption) : c.image.caption } : c.image,
  }));
  const shortDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // Kicker + crimson rule under it. On white sheets the kicker is crimson; on
  // the black ground (micro-memoir) it's cool grey.
  const kicker = (name: string, onDark: boolean, center: boolean) => {
    const align = center ? "text-align:center;" : "";
    const rule = `<div style="width:40px;height:2px;background:${CRIMSON};${center ? "margin:0 auto;" : ""}"></div>`;
    return `<div style="${align}font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${onDark ? LINE : CRIMSON};margin:0 0 8px;">${name}</div>${rule}`;
  };

  const caption = (text?: string) =>
    text ? `<p style="font-family:${FONT};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${TEXT_MUTED};margin:6px 34px 0;">${esc(text)}</p>` : "";

  const byline = (b?: string, extra?: string, center?: boolean) =>
    b ? `<p style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${TEXT_MUTED};${center ? "text-align:center;" : ""}margin:16px 0 20px;">By ${esc(b)}${extra ? ` · ${esc(extra)}` : ""}</p>` : "";

  // Text is inset 34px; photos bleed to the white sheet's edges.
  const TX = "padding:0 34px;";

  let archiveN = 0;

  const cardsHtml = cards.map((card, idx) => {
    const type = effectiveType(card, idx);

    // ---- ESSAYS: white sheet, left-aligned feature ----
    if (type === "essays") {
      const img = card.image?.url
        ? `<div style="margin:22px 0 0;"><img src="${esc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;max-height:300px;object-fit:cover;display:block;" />${caption(card.image.caption)}</div>`
        : "";
      return `<div style="padding:0 16px 16px;">
        <div style="background:${PAPER};padding:34px 0;">
          <div style="${TX}">${kicker("ESSAYS", false, false)}</div>
          <h2 style="${TX}font-family:${SERIF};font-size:29px;font-weight:700;line-height:1.1;color:${INK};margin:14px 0 0;">${esc(card.headline ?? "")}</h2>
          <div style="${TX}">${byline(card.byline)}</div>
          ${img}
          <div style="${TX}margin-top:20px;">${renderBody(card.body ?? [])}</div>
        </div>
      </div>`;
    }

    // ---- NARRATIVES: white sheet, centered header, 16:9 photo ----
    if (type === "narratives") {
      const img = card.image?.url
        ? `<div style="margin:24px 0 0;"><img src="${esc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;aspect-ratio:16/9;max-height:338px;object-fit:cover;display:block;" />${caption(card.image.caption)}</div>`
        : "";
      return `<div style="padding:0 16px 16px;">
        <div style="background:${PAPER};padding:34px 0;">
          <div style="${TX}">${kicker("NARRATIVES", false, true)}</div>
          <h1 style="${TX}font-family:${SERIF};font-size:34px;font-weight:700;line-height:1.06;color:${INK};text-align:center;margin:14px 0 0;">${esc(card.headline ?? "")}</h1>
          <div style="${TX}">${byline(card.byline, undefined, true)}</div>
          ${img}
          <div style="${TX}margin-top:20px;">${renderBody(card.body ?? [])}</div>
        </div>
      </div>`;
    }

    // ---- MICRO-MEMOIR: tweet card directly on black ground ----
    if (type === "micro-memoir") {
      const img = card.image?.url
        ? `<img src="${esc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;border-radius:12px;margin:14px 0 0;display:block;" />`
        : "";
      return `<div style="padding:0 16px 16px;">
        <div style="margin-bottom:14px;">${kicker("MICRO-MEMOIR", true, false)}</div>
        <div style="background:${PAPER};border:1px solid ${LINE};border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.4);padding:20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="44" valign="top" style="width:44px;">
              <div style="width:44px;height:44px;background:${CRIMSON};border-radius:50%;text-align:center;line-height:44px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;">${initials(card.byline)}</div>
            </td>
            <td valign="middle" style="padding-left:12px;">
              <div style="font-family:${FONT};font-size:15px;font-weight:700;color:${INK};">${esc(card.byline ?? "Gangrey")}</div>
              <div style="font-family:${FONT};font-size:13px;color:${TEXT_MUTED};">${esc(card.headline ?? "")} · ${shortDate}</div>
            </td>
          </tr></table>
          <div style="margin-top:14px;">${renderBody(card.body ?? [], { size: 19, line: 1.5, align: "left" })}</div>
          ${img}
          <div style="border-top:1px solid ${LINE};margin-top:16px;padding-top:12px;font-family:${FONT};font-size:12px;letter-spacing:0.04em;color:${TEXT_MUTED};">
            ${esc(shortDate)} · <span style="color:${CRIMSON};">A micro-memoir</span>
          </div>
        </div>
      </div>`;
    }

    // ---- ARCHIVE: torn newspaper clipping on black ground ----
    const clipIdx = archiveN % 2;
    archiveN++;
    const img = card.image?.url
      ? `<div style="margin:0 0 16px;"><img src="${esc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;filter:grayscale(1) contrast(1.08);display:block;" />${card.image.caption ? `<p style="font-family:${FONT};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${TEXT_MUTED};margin:6px 0 0;">${esc(card.image.caption)}</p>` : ""}</div>`
      : "";
    return `<div style="padding:0 16px 24px;">
      <div style="margin-bottom:16px;">${kicker("FROM THE ARCHIVE", true, false)}</div>
      <div style="position:relative;transform:rotate(${TILT[clipIdx]});filter:drop-shadow(0 8px 16px rgba(0,0,0,0.5));">
        <div style="position:absolute;top:-8px;left:24px;width:90px;height:22px;background:${TAPE};transform:rotate(-5deg);"></div>
        <div style="position:absolute;top:-8px;right:24px;width:90px;height:22px;background:${TAPE};transform:rotate(5deg);"></div>
        <div style="background:${PAPER};clip-path:${TORN[clipIdx]};padding:34px 30px;">
          <div style="border-bottom:1px solid ${INK};padding-bottom:6px;margin-bottom:18px;font-family:${SERIF};font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:${INK};">Gangrey · Archive · ${esc(shortDate)}</div>
          <h2 style="font-family:${SERIF};font-size:34px;font-weight:700;line-height:1.08;color:${INK};margin:0 0 8px;">${esc(card.headline ?? "")}</h2>
          ${card.byline ? `<p style="font-family:${SERIF};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${TEXT_MUTED};margin:0 0 18px;">By ${esc(card.byline)}</p>` : ""}
          ${img}
          <div>${renderBody(card.body ?? [], CLIP_BODY)}</div>
        </div>
      </div>
    </div>`;
  }).join("");

  // ---- COVER (masthead) ----
  const cover = opts.masthead
    ? `<div style="background:${GROUND};padding:16px;">
        <div style="border:1px solid ${LINE};padding:30px 34px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px;"><tr>
            <td align="left" style="font-family:${FONT};font-size:9px;letter-spacing:0.28em;text-transform:uppercase;color:${LINE};">A Literary Magazine</td>
            <td align="right" style="font-family:${FONT};font-size:9px;letter-spacing:0.28em;text-transform:uppercase;color:${LINE};">Gangrey.org</td>
          </tr></table>
          <a href="${SITE_URL}" target="_blank" rel="noopener" style="text-decoration:none;">
            <img src="${base}/Wordmark-White.png?v=1" alt="Gangrey" width="290" style="width:290px;max-width:100%;display:block;margin:0 auto 18px;border:0;" />
          </a>
          <div style="width:40px;height:2px;background:${CRIMSON};margin:0 auto 18px;"></div>
          ${subject ? `<p style="font-family:${SERIF};font-size:22px;color:#ffffff;text-align:center;margin:0 0 10px;">${esc(subject)}</p>` : ""}
          ${intro ? `<p style="font-family:${SERIF};font-size:15px;line-height:1.6;color:${LINE};text-align:center;max-width:440px;margin:0 auto 16px;white-space:pre-line;">${esc(intro)}</p>` : ""}
          ${author ? `<p style="font-family:${FONT};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;text-align:center;color:${LINE};margin:0 0 22px;">Guest Editor · <span style="color:#ffffff;">${esc(author)}</span></p>` : ""}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE};"><tr>
            <td align="left" style="padding-top:14px;font-family:${FONT};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#ffffff;">Est. 2026</td>
            <td align="right" style="padding-top:14px;font-family:${SERIF};font-size:12px;color:#ffffff;">${volume ? `<span style="color:${LINE};">Vol.</span> ${esc(volume)}` : ""}${volume && issue ? "  " : ""}${issue ? `<span style="color:${LINE};">No.</span> ${esc(issue)}` : ""}</td>
          </tr></table>
        </div>
      </div>`
    : "";

  return `${cover}
    <div style="background:${GROUND};padding-top:16px;">
      ${cardsHtml}
    </div>`;
}

// The full newsletter sheet — content + unsubscribe footer. The cover masthead
// (wordmark) is included only in the email; the web reader omits it because the
// site's MagHeader already shows the wordmark (avoids a double header).
function renderNewsletterSheet(opts: NlOpts, includeMasthead: boolean): string {
  return `<div style="width:100%;max-width:600px;margin:0 auto;background:${GROUND};">
    ${renderNewsletterContent(opts, { masthead: includeMasthead })}
    <div style="background:${GROUND};padding:16px;">
      <div style="border:1px solid ${LINE};padding:18px 20px;text-align:center;">
        <p style="font-family:${FONT};font-size:10px;color:${LINE};letter-spacing:0.14em;text-transform:uppercase;margin:0 0 8px;">You're receiving this because you subscribed to Gangrey</p>
        <a href="${SITE_URL}/unsubscribe" target="_blank" rel="noopener" style="font-family:${FONT};font-size:10px;font-weight:700;color:#ffffff;letter-spacing:0.18em;text-transform:uppercase;text-decoration:none;border-bottom:1px solid ${CRIMSON};padding-bottom:1px;">Unsubscribe</a>
      </div>
    </div>
  </div>`;
}

// Web reader version — used on /issues/[slug]. No wordmark masthead (MagHeader
// already shows it), so the on-site render isn't double-headed.
export function renderNewsletterPageHtml(opts: NlOpts): string {
  return renderNewsletterSheet(opts, false);
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
