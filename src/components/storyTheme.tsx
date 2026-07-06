// Shared visual treatment for the story template (/stories/[slug] and its
// admin preview): CSS block, PortableText components, and caption parsing.

export const storyStyles = `
  .story-page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: #ffffff;
    color: #000000;
  }
  .story-head {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 20px 40px 26px;
    box-sizing: border-box;
    text-align: center;
  }
  .story-label {
    text-decoration: none;
    display: inline-block;
    font-family: var(--font-subhead);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: .26em;
    text-transform: uppercase;
    color: #490000;
    margin-bottom: 14px;
  }
  .story-h1 {
    font-family: var(--font-headline);
    font-weight: 800;
    font-size: clamp(28px, 3.6vw, 40px);
    line-height: 1.05;
    letter-spacing: -.03em;
    margin: 0;
  }
  .story-dek {
    font-family: var(--font-body);
    font-style: italic;
    font-size: 20px;
    line-height: 1.4;
    color: #392a22;
    margin: 18px auto 0;
    max-width: 560px;
  }
  .story-meta {
    margin-top: 20px;
    font-family: var(--font-subhead);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: .16em;
    text-transform: uppercase;
    color: #000000;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .story-meta .dot { color: #b8b8ba; }
  .story-meta .rt { color: #490000; }
  .story-hero-wrap {
    width: 100%;
    max-width: 1290px;
    margin: 0 auto;
    padding: 0 32px;
    box-sizing: border-box;
  }
  .story-hero {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background: linear-gradient(135deg, #4a3527, #181109);
    margin-bottom: 6px;
  }
  .story-hero img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .story-cutline-wrap {
    width: 100%;
    max-width: 1290px;
    margin: 0 auto;
    padding: 0 32px;
    box-sizing: border-box;
  }
  .story-cutline {
    font-family: var(--font-subhead);
    font-size: 12px;
    letter-spacing: .04em;
    color: #8a8a8c;
    font-style: italic;
    font-weight: 400;
    padding: 10px 0 0;
    line-height: 1.5;
  }
  .story-cutline strong { font-style: normal; font-weight: 400; color: #8a8a8c; }
  .story-article {
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
    padding: 38px 40px 20px;
    box-sizing: border-box;
  }
  .story-body {
    font-family: var(--font-body);
    font-size: 19px;
    line-height: 1.66;
    color: #000000;
    font-feature-settings: "calt" 0, "liga" 0;
  }
  .story-body > p:first-of-type::first-letter {
    float: left;
    font-size: 82px;
    line-height: .66;
    font-weight: 800;
    color: #490000;
    padding: 10px 12px 0 0;
  }
  .story-body p { margin: 0 0 22px; }
  .story-body blockquote {
    margin: 34px 0;
    padding: 0;
    border: 0;
    font-size: 30px;
    line-height: 1.24;
    font-style: italic;
    letter-spacing: -.01em;
    color: #490000;
    text-align: center;
  }
  .story-body a { color: #490000; text-decoration: underline; }
  .story-body ul { list-style: disc; padding-left: 1.4em; margin: 0 0 22px; }
  .story-body ol { list-style: decimal; padding-left: 1.4em; margin: 0 0 22px; }
  .story-body li { display: list-item; margin-bottom: .25em; }
  .story-foot {
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
    padding: 18px 40px 28px;
    box-sizing: border-box;
  }
  .story-foot-rule {
    border-top: 1px dotted #8a8a8c;
  }
  .story-actions {
    margin-top: 26px;
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .story-actions button {
    color: #490000 !important;
  }
  .story-actions button svg { width: 13px; height: 13px; }
  .story-actions button span {
    font-family: var(--font-subhead) !important;
    font-size: 11px !important;
    font-weight: 700;
    letter-spacing: .14em;
    text-transform: uppercase;
  }
  .story-like button span::after { content: " Likes"; }
  .story-comments {
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
    padding: 8px 40px 56px;
    box-sizing: border-box;
  }
  @media (max-width: 900px) {
    .story-head { padding: 20px 22px 20px; }
    .story-hero-wrap { padding: 0 20px; }
    .story-cutline-wrap { padding: 0 20px; }
    .story-article { padding: 30px 22px 16px; }
    .story-foot { padding: 20px 22px 32px; }
    .story-comments { padding: 8px 22px 48px; }
    .story-body { font-size: 18px; }
    .story-body > p:first-of-type::first-letter {
      font-size: 64px;
      line-height: .72;
      padding: 8px 10px 0 0;
    }
    .story-body blockquote { font-size: 24px; }
  }
`;

// Splits a caption like "Slack tide, off Silver Lake. — Marla Vitense for Gangrey"
// into a bold non-italic lead-in and an italic "— credit" tail.
export function splitCaption(caption: string): { lead: string; credit: string | null } {
  const idx = caption.indexOf("—");
  if (idx > 0) {
    return { lead: caption.slice(0, idx).trim(), credit: caption.slice(idx + 1).trim() };
  }
  return { lead: caption.trim(), credit: null };
}

export const storyPtComponents = {
  block: {
    normal: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 style={{ fontFamily: 'var(--font-headline)', fontWeight: 700, fontSize: "1.9rem", margin: "2.2rem 0 0", lineHeight: 1.15, letterSpacing: "-.02em" }}>{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 style={{ fontFamily: 'var(--font-headline)', fontWeight: 700, fontSize: "1.5rem", margin: "1.8rem 0 0", lineHeight: 1.2 }}>{children}</h3>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote>{children}</blockquote>,
  },
  list: {
    bullet: ({ children }: { children?: React.ReactNode }) => <ul>{children}</ul>,
    number: ({ children }: { children?: React.ReactNode }) => <ol>{children}</ol>,
  },
  listItem: {
    bullet: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
    number: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  },
  types: {
    imageEmbed: ({ value }: { value: { src: string; alt?: string } }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={value.src} alt={value.alt ?? ""} style={{ maxWidth: "100%", margin: "1.4rem 0", display: "block" }} />
    ),
    youtubeEmbed: ({ value }: { value: { src: string } }) => (
      <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, margin: "1.4rem 0" }}>
        <iframe src={value.src.replace("watch?v=", "embed/")} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} allowFullScreen />
      </div>
    ),
  },
  marks: {
    strong: ({ children }: { children?: React.ReactNode }) => <strong>{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
    link: ({ children, value }: { children?: React.ReactNode; value?: { href?: string } }) => (
      <a href={value?.href} target="_blank" rel="noopener noreferrer">{children}</a>
    ),
  },
};
