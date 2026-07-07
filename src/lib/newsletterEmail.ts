// Renders newsletter cards (portable text) into a self-contained HTML email.
// Kept dependency-free: a small serializer for the block types our editor emits.
import type { PortableTextBlock } from "@portabletext/types";
import { straightenQuotes, straightenBlocks } from "./straighten";
import { CRIMSON, INK, TEXT_MUTED, CREAM, LINE } from "./palette";

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

// Email clients (and the preview iframe) can't load a relative path, so the
// masthead image needs an absolute URL to match the in-app editor's wordmark.
// Canonical public host for email links (wordmark image, unsubscribe). Hardcoded
// to the production domain rather than read from NEXT_PUBLIC_SITE_URL, which has
// historically been left pointing at the old "efemera.org" project and sent
// recipients to a dead unsubscribe page.
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

function renderBody(blocks: PortableTextBlock[]): string {
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
      out.push(`<${tag} style="font-family:${HEADLINE_FONT};font-size:18px;line-height:1.7;color:${INK};margin:0 0 16px;padding-left:22px;">${items.join("")}</${tag}>`);
      continue;
    }

    if (style === "h2") out.push(`<h2 style="font-family:${HEADLINE_FONT};font-size:24px;font-weight:700;color:${INK};margin:28px 0 6px;">${inline}</h2>`);
    else if (style === "blockquote") out.push(`<blockquote style="border-left:3px solid ${CRIMSON};margin:16px 0;padding:2px 0 2px 16px;font-style:italic;color:${TEXT_MUTED};font-family:${HEADLINE_FONT};font-size:18px;">${inline}</blockquote>`);
    else out.push(`<p style="font-family:${HEADLINE_FONT};font-size:18px;line-height:1.7;color:${INK};margin:0 0 16px;">${inline}</p>`);
    i++;
  }
  return out.join("");
}

const HEADLINE_FONT = SERIF;

function effectiveType(card: NlCard, idx: number): "narratives" | "essays" | "micro-memoir" | "archive" {
  const t = card.cardType;
  if (t === "narratives" || t === "feature") return "narratives";
  if (t === "essays" || t === "standard") return "essays";
  if (t === "micro-memoir" || t === "digest") return "micro-memoir";
  if (t === "archive") return "archive";
  if (idx === 0) return "narratives";
  return "essays";
}

type NlOpts = { subject: string; preview: string; intro?: string; author?: string; volume?: string; issue?: string; cards: NlCard[]; baseUrl?: string };

// Single source of truth — produces the exact markup the admin editor canvas
// renders. Both the web reader (/issues/[slug]) and the email reuse this so the
// preview, the sent email, and the editor all look identical. The only knob is
// whether to include the cream wordmark masthead (the web reader omits it
// because MagHeader already shows the wordmark above it).
function renderNewsletterContent(raw: NlOpts, opts: { masthead: boolean }): string {
  // Enforce straight quotes across all newsletter text (matches site house style).
  const intro = raw.intro ? straightenQuotes(raw.intro) : raw.intro;
  const author = raw.author ? straightenQuotes(raw.author) : raw.author;
  const { volume, issue } = raw;
  const base = (raw.baseUrl ?? SITE_URL).replace(/\/$/, "");
  const cards = raw.cards.map(c => ({
    ...c,
    headline: c.headline ? straightenQuotes(c.headline) : c.headline,
    byline: c.byline ? straightenQuotes(c.byline) : c.byline,
    body: c.body ? straightenBlocks(c.body) : c.body,
    image: c.image ? { ...c.image, caption: c.image.caption ? straightenQuotes(c.image.caption) : c.image.caption } : c.image,
  }));
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  // Horizontal padding for text. Images live OUTSIDE this padding so they bleed
  // to the 600px edges in every client — Gmail strips the negative-margin
  // breakout trick, so we never use it; only text is inset.
  const PADX = "padding-left:40px;padding-right:40px;";

  const sectionLabel = (name: string) =>
    `<div style="${PADX}padding-top:20px;font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${CRIMSON};margin-bottom:6px;">${name}</div>`;

  const caption = (text?: string) =>
    text ? `<p style="${PADX}font-family:${FONT};font-size:11px;font-style:italic;color:${TEXT_MUTED};margin:6px 0 0;">${esc(text)}</p>` : "";

  const cardsHtml = cards.map((card, idx) => {
    const type = effectiveType(card, idx);
    const sectionName = type === "narratives" ? "NARRATIVES" : type === "essays" ? "ESSAYS" : "MICRO-MEMOIR";

    if (type === "narratives") {
      const img = card.image?.url
        ? `<div style="margin:0 0 28px;">
             <img src="${esc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;max-height:400px;object-fit:cover;display:block;" />
             ${caption(card.image.caption)}
           </div>`
        : "";
      return `<div>
        ${sectionLabel(sectionName)}
        <div style="padding-top:16px;padding-bottom:32px;">
          ${img}
          <h1 style="${PADX}font-family:${SERIF};font-size:30px;font-weight:700;line-height:1.15;color:${CRIMSON};text-align:center;margin:0 0 16px;">${esc(card.headline ?? "")}</h1>
          ${card.byline ? `<p style="${PADX}font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.02em;color:${INK};text-align:center;margin:0 0 16px;">By ${esc(card.byline)}</p>` : ""}
          <div style="${PADX}text-align:left;">${renderBody(card.body ?? [])}</div>
        </div>
      </div>`;
    }

    if (type === "essays") {
      const img = card.image?.url
        ? `<div style="margin:0 0 14px;">
             <img src="${esc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;max-height:240px;object-fit:cover;display:block;" />
             ${caption(card.image.caption)}
           </div>`
        : "";
      return `<div>
        ${sectionLabel(sectionName)}
        <div style="padding-bottom:28px;">
          <div style="${PADX}border-top:2px solid ${CRIMSON};padding-top:14px;margin-bottom:14px;">
            <h2 style="font-family:${SERIF};font-size:24px;font-weight:400;line-height:1.25;color:${CRIMSON};margin:0;">${esc(card.headline ?? "")}</h2>
          </div>
          ${card.byline ? `<p style="${PADX}font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.02em;color:${INK};margin:0 0 14px;">By ${esc(card.byline)}</p>` : ""}
          ${img}
          <div style="${PADX}text-align:left;">${renderBody(card.body ?? [])}</div>
        </div>
      </div>`;
    }

    if (type === "archive") {
      const img = card.image?.url
        ? `<div style="margin:0 0 20px;">
             <img src="${esc(card.image.url)}" alt="${esc(card.image.alt ?? "")}" style="width:100%;max-height:220px;object-fit:cover;display:block;" />
             ${caption(card.image.caption)}
           </div>`
        : "";
      return `<div>
        ${sectionLabel("FROM THE ARCHIVE")}
        <div style="background:#ffffff;border:1px solid ${LINE};border-top:3px solid ${CRIMSON};padding:24px 32px 32px;text-align:center;margin:12px 24px;">
          ${img}
          <h2 style="font-family:${SERIF};font-size:26px;font-weight:700;line-height:1.25;color:${INK};margin:0 0 8px;">${esc(card.headline ?? "")}</h2>
          ${card.byline ? `<p style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${CRIMSON};margin:0 0 20px;">By ${esc(card.byline)}</p>` : ""}
          <div style="width:32px;height:1px;background:${LINE};margin:0 auto 20px;"></div>
          <div style="text-align:left;">${renderBody(card.body ?? [])}</div>
        </div>
      </div>`;
    }

    return `<div>
      <div style="background:#ffffff;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};padding:32px 32px 40px;text-align:center;margin:20px 0 0;">
        <p style="font-family:${SERIF};font-size:27px;font-weight:400;line-height:1.2;letter-spacing:0.02em;color:${INK};margin:0 0 6px;">${esc(card.headline ?? "")}</p>
        <p style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${CRIMSON};margin:0 0 24px;">A Micro-Memoir${card.byline ? ` by ${esc(card.byline)}` : ""}</p>
        <div style="width:32px;height:1px;background:${LINE};margin:0 auto 24px;"></div>
        <div>${renderBody(card.body ?? [])}</div>
      </div>
    </div>`;
  }).join("");

  const masthead = opts.masthead
    ? `<div style="background:${CREAM};padding:16px 24px 14px;text-align:center;border-bottom:1px solid ${LINE};">
         <img src="${base}/Wordmark.png?v=7" alt="Gangrey" width="300" height="110" style="width:300px;height:110px;max-width:100%;display:block;margin:0 auto;border:0;" />
       </div>`
    : "";

  return `${masthead}
    <div style="background:${CRIMSON};padding:10px 40px 24px;text-align:center;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
        <tr>
          <td align="left" style="font-family:${FONT};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${CREAM};">${date}</td>
          <td align="right" style="font-family:${FONT};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${CREAM};">${volume ? `Vol. ${esc(volume)}` : ""}${volume && issue ? " · " : ""}${issue ? `No. ${esc(issue)}` : ""}</td>
        </tr>
      </table>
      ${intro ? `<div style="max-width:440px;margin:0 auto;">
        <p style="font-family:${SERIF};font-size:16px;line-height:1.6;color:${CREAM};margin:0;white-space:pre-line;">${esc(intro)}</p>
        ${author ? `<p style="font-family:${FONT};font-size:12px;font-weight:700;color:#ffffff;margin:10px 0 0;letter-spacing:0.08em;text-transform:uppercase;">By ${esc(author)}</p>` : ""}
      </div>` : ""}
    </div>
    <div style="padding:0 0 40px;">
      ${cardsHtml}
    </div>`;
}

// The full newsletter sheet — content + unsubscribe footer. The masthead
// (wordmark) is included only in the email; the web reader omits it because the
// site's MagHeader already shows the wordmark (avoids a double header).
function renderNewsletterSheet(opts: NlOpts, includeMasthead: boolean): string {
  return `<div style="width:100%;max-width:600px;margin:0 auto;background:${CREAM};">
    ${renderNewsletterContent(opts, { masthead: includeMasthead })}
    <div style="background:${CRIMSON};padding:20px 40px;text-align:center;">
      <p style="font-family:${FONT};font-size:10px;color:#ffffff;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 6px;">You're receiving this because you subscribed to Gangrey</p>
      <a href="${SITE_URL}/unsubscribe" target="_blank" rel="noopener" style="font-family:${FONT};font-size:10px;font-weight:600;color:#ffffff;letter-spacing:0.18em;text-transform:uppercase;text-decoration:none;">Unsubscribe</a>
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
  /* Keep brand colors fixed in clients that force dark mode. */
  u + .body .force-light { background-color: inherit !important; }
  [data-ogsc] .force-light, [data-ogsb] .force-light { background-color: inherit !important; }
</style></head>
<body style="margin:0;padding:0;background:${CREAM};">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preview)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;border-collapse:collapse;background:${CREAM};">
    <tr><td align="center" style="padding:0;">
      ${renderNewsletterSheet(opts, true)}
    </td></tr>
  </table>
</body></html>`;
}
