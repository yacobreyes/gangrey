"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { SanityPost, SanityLately, SanityWelcome } from "@/lib/sanity";
import { urlFor } from "@/lib/sanityImage";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import { postReadingTime } from "@/lib/readingTime";

type Tab = "Home" | "About" | "Micro-Memoirs" | "Narratives" | "Essays" | "Archive";

function portableToPlainText(blocks: SanityPost["body"]): string {
  return blocks
    .filter(b => b._type === "block")
    .map(b => (b.children as { text: string }[]).map(c => c.text).join(""))
    .join(" ");
}

function sectionLabel(section: SanityPost["section"]) {
  if (section === "Archive") return "From the Archive";
  return section;
}

export default function Feed({
  posts,
  onMastheadClick,
  searchQuery = "",
}: {
  posts: SanityPost[];
  aboutParagraphs: string[];
  lately: SanityLately | null;
  welcome: SanityWelcome | null;
  initialTab: Tab;
  onMastheadClick?: () => void;
  searchQuery?: string;
}) {
  const published = posts.filter(p =>
    !p.status || p.status === "published" ||
    (p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt) <= new Date())
  );

  const isGangrey = (p: { section?: string }) => p.section === "Archive";
  const nonGangrey = published.filter(p => !isGangrey(p));

  const q = searchQuery.trim().toLowerCase();
  const searchResults = q
    ? published.filter(p =>
        p.headline.toLowerCase().includes(q) ||
        p.byline.toLowerCase().includes(q) ||
        p.subheadline?.toLowerCase().includes(q) ||
        (p.searchText ?? portableToPlainText(p.body)).toLowerCase().includes(q)
      )
    : [];

  const hero = nonGangrey[0];
  const cards = nonGangrey.slice(1, 4);
  const archiveFeature = published.find(p =>
    isGangrey(p) && (
      p.slug === "starting-somewhere" ||
      p.headline?.toLowerCase().includes("starting somewhere")
    )
  ) ?? null;
  const latestCards = [...cards, ...(archiveFeature ? [archiveFeature] : [])];

  // Dot pagination for the mobile carousel — tracks which card is currently
  // snapped into view so the active dot can highlight, New Yorker-style.
  const carouselRef = useRef<HTMLDivElement>(null);
  const [activeCard, setActiveCard] = useState(0);
  function onCarouselScroll() {
    const el = carouselRef.current;
    if (!el) return;
    const cardEls = el.querySelectorAll<HTMLElement>(".hm-card");
    if (cardEls.length === 0) return;
    const cardWidth = cardEls[0].getBoundingClientRect().width;
    const gap = 18;
    const i = Math.round(el.scrollLeft / (cardWidth + gap));
    setActiveCard(Math.max(0, Math.min(latestCards.length - 1, i)));
  }
  function scrollToCard(i: number) {
    const el = carouselRef.current;
    if (!el) return;
    const card = el.querySelectorAll<HTMLElement>(".hm-card")[i];
    if (card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: "smooth" });
  }

  const heroImg = hero?.image?.asset
    ? urlFor(hero.image.asset).width(1600).height(900).fit("crop").auto("format").url()
    : null;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; color: #000000; font-family: var(--font-body); -webkit-font-smoothing: antialiased; }
        a { color: inherit; text-decoration: none; }

        /* HERO — magazine-cover layout: photo on top, text stacked below and
           centered on every breakpoint (no overlay on the image). */
        .hm-hero-wrap { padding: 20px 76px 0; }
        .hm-hero-link { display: block; color: inherit; }
        .hm-hero {
          position: relative;
          display: block;
          aspect-ratio: 16 / 9;
          overflow: hidden;
          background: linear-gradient(135deg, #4a3527 0%, #241a13 60%, #0f0b08 100%);
        }
        .hm-hero-img {
          position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: cover; display: block;
        }
        .hm-hero-credit-below {
          margin-top: 8px;
          font-family: var(--font-subhead);
          font-size: 11px; letter-spacing: .03em; font-weight: 400;
          color: #8a8a8c; text-align: center;
        }
        .hm-hero-below { padding: 26px 4px 0; color: #000000; text-align: center; }
        .hm-kicker {
          display: inline-block; white-space: nowrap;
          background: #490000; color: #ffffff;
          font-family: var(--font-subhead);
          font-weight: 800; font-size: 10px; letter-spacing: .2em; text-transform: uppercase;
          padding: 6px 11px;
        }
        .hm-kicker-below { margin-bottom: 18px; }
        .hm-h1-below {
          margin: 0 auto; max-width: 900px;
          font-family: var(--font-headline);
          font-size: clamp(40px, 4.6vw, 60px);
          line-height: .98; letter-spacing: -.03em; font-weight: 800; color: #000000;
        }
        .hm-dek-below {
          margin: 18px auto 0; max-width: 620px;
          font-size: 20px; line-height: 1.4; font-style: italic; color: #392a22;
        }
        .hm-hero-meta-below {
          margin-top: 22px;
          display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 16px;
          font-family: var(--font-subhead);
          font-weight: 700; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: #000000;
        }
        .hm-hero-meta-below .hm-dot { color: #490000; }

        /* LATEST */
        .hm-latest { padding: 36px 76px 40px; background: #ffffff; }
        .hm-latest-head {
          display: flex; align-items: baseline; justify-content: space-between;
          margin-bottom: 30px;
        }
        .hm-latest-head h2 {
          margin: 0;
          font-family: var(--font-headline);
          font-size: 26px; font-weight: 800; letter-spacing: -.02em;
        }
        .hm-latest-head a {
          font-size: 17px; font-style: italic; color: #490000;
        }
        .hm-grid {
          display: grid;
          grid-template-columns: 1fr 1px 1fr 1px 1fr 1px 1fr;
          column-gap: 34px;
        }
        .hm-divider { border-left: 1px dotted #8a8a8c; }
        .hm-card { display: block; }
        .hm-thumb {
          position: relative;
          display: block; width: 100%; aspect-ratio: 1.35 / 1;
          margin-bottom: 18px; background: #b8b8ba; overflow: hidden;
        }
        .hm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s; }
        .hm-thumb:hover img { transform: scale(1.03); }
        .hm-label {
          font-family: var(--font-subhead);
          font-weight: 800; font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
          color: #490000; margin-bottom: 10px;
        }
        .hm-card h3 {
          margin: 0 0 10px;
          font-family: var(--font-headline);
          font-size: 28px; line-height: 1.02; letter-spacing: -.02em; font-weight: 800;
        }
        .hm-byline { font-size: 18px; font-style: italic; margin-bottom: 0; }
        .hm-carousel-dots { display: none; }
        .hm-time {
          margin-top: 18px;
          font-family: var(--font-subhead);
          font-weight: 700; font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase;
        }

        /* LIFE IN BRIEF */
        .hm-brief-wrap { padding: 0 76px; }
        .hm-brief {
          display: grid; grid-template-columns: 1fr auto auto; align-items: center;
          gap: 48px; padding: 38px 44px;
          background: #490000; color: #ffffff;
        }
        .hm-brief-left { width: fit-content; }
        .hm-brief-title {
          font-family: var(--font-headline);
          font-size: 34px; font-weight: 800; line-height: 1.06; letter-spacing: -.02em;
          margin-bottom: 14px;
        }
        .hm-brief-sub { margin: 0; font-size: 18px; font-style: italic; }
        .hm-circles { display: flex; gap: 20px; }
        .hm-circle {
          width: 78px; height: 78px; border-radius: 50%; border: 1.5px solid #ffffff;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          color: #ffffff; cursor: pointer;
          background: transparent;
          transition: background .15s, color .15s;
        }
        .hm-circle:hover, .hm-circle:focus-visible {
          background: #ffffff; color: #490000;
        }
        .hm-circle strong {
          font-family: var(--font-subhead);
          font-size: 28px; font-weight: 800; line-height: 1;
        }
        .hm-circle span {
          font-family: var(--font-subhead);
          font-size: 10px; font-weight: 800; letter-spacing: .14em;
        }
        .hm-brief-caption {
          display: flex; align-items: center; justify-content: center; gap: 10px;
          font-style: italic; font-size: 15px; text-align: center; line-height: 1.3;
          color: #ffffff;
        }
        .hm-brief-caption .hm-arrow { font-size: 24px; line-height: 1; }

        /* MOBILE */
        @media (max-width: 900px) {
          .hm-hero-wrap { padding: 20px 20px 0; }
          /* Same below-the-photo stack as desktop, tightened for phones: a
             square photo, smaller headline/dek, and no kicker badge. */
          .hm-hero { aspect-ratio: 1 / 1; }
          .hm-hero-below { padding: 22px 4px 0; }
          .hm-kicker-below { display: none; }
          .hm-h1-below {
            font-size: clamp(28px, 8vw, 38px); line-height: 1.08;
            letter-spacing: -.01em; max-width: none;
          }
          .hm-dek-below {
            margin: 12px auto 0; font-family: var(--font-body); font-style: normal;
            font-size: 16px; line-height: 1.4; color: #000000; max-width: 340px;
          }
          .hm-hero-meta-below {
            margin-top: 14px; gap: 8px;
            font-size: 10.5px; letter-spacing: .14em;
          }

          .hm-latest { padding: 36px 0 44px; }
          .hm-latest-head { flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 20px; padding: 0 20px; }
          /* Horizontally-scrolling carousel on mobile — same visual card as
             desktop (image, kicker, bold headline, italic byline, read time,
             no excerpt), just swipeable one at a time with a thin divider
             peeking at the next card and dot pagination below. */
          .hm-grid {
            display: flex;
            grid-template-columns: none;
            overflow-x: auto;
            scroll-snap-type: x mandatory;
            scroll-padding-left: 20px;
            -webkit-overflow-scrolling: touch;
            gap: 22px;
            padding: 0 20px 6px;
          }
          .hm-divider { display: block; border-left: 1px solid #e5e5e5; align-self: stretch; flex-shrink: 0; width: 0; margin: 0; }
          .hm-card { flex: 0 0 82vw; max-width: 340px; scroll-snap-align: start; }
          .hm-thumb { aspect-ratio: 1.35 / 1; margin-bottom: 16px; }
          .hm-label { font-size: 10px; margin-bottom: 8px; }
          .hm-card h3 { font-size: 22px; line-height: 1.05; margin: 0 0 8px; }
          .hm-byline { font-size: 15px; }
          .hm-time { font-size: 9.5px; margin-top: 14px; }
          .hm-carousel-dots { display: flex; justify-content: center; gap: 8px; margin-top: 18px; }
          .hm-carousel-dot {
            width: 6px; height: 6px; border-radius: 50%; padding: 0;
            border: none; background: #d8d8d8; cursor: pointer;
          }
          .hm-carousel-dot.active { background: #490000; }

          .hm-brief-wrap { padding: 0 20px; }
          /* Single horizontal row: title/sub on the left, the 1/3/5 circles on
             the right — not stacked. The "stories that fit your window" caption
             is dropped on mobile (it's redundant with the circles). */
          .hm-brief { display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; }
          .hm-brief-left { flex: 0 1 auto; width: auto; min-width: 0; }
          .hm-brief-title { font-size: 17px; margin-bottom: 3px; }
          .hm-brief-sub { font-size: 10.5px; }
          .hm-circles { gap: 7px; flex-shrink: 0; }
          .hm-circle { width: 46px; height: 46px; border-width: 1px; }
          .hm-circle strong { font-size: 15px; }
          .hm-circle span { font-size: 6.5px; letter-spacing: .1em; }
          .hm-brief-caption { display: none; }
        }
      `}</style>

      <MagHeader onLogoClick={onMastheadClick} />

      {/* SEARCH RESULTS */}
      {q && (
        <section style={{ width: "100%", maxWidth: 1180, margin: "0 auto", padding: "56px 44px 72px", boxSizing: "border-box" }}>
          <div style={{ borderBottom: "1px solid #000000", paddingBottom: 20, marginBottom: 36 }}>
            <p style={{ fontFamily: "var(--font-subhead)", fontSize: 11, fontWeight: 800, letterSpacing: ".2em", textTransform: "uppercase", color: "#490000", margin: "0 0 10px" }}>Search</p>
            <h1 style={{ fontFamily: 'var(--font-headline)', fontSize: "clamp(36px, 5vw, 58px)", fontWeight: 800, lineHeight: .98, letterSpacing: "-.03em", margin: 0 }}>"{searchQuery}"</h1>
          </div>
          {searchResults.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {searchResults.map(p => (
                <Link key={p._id} href={`/stories/${p.slug}`} style={{ display: "block", padding: "28px 0", borderBottom: "1px dotted #8a8a8c", textDecoration: "none", color: "inherit" }}>
                  <div style={{ fontFamily: "var(--font-subhead)", fontSize: 11, fontWeight: 800, letterSpacing: ".2em", textTransform: "uppercase", color: "#490000", marginBottom: 8 }}>{sectionLabel(p.section)}</div>
                  <h2 style={{ fontFamily: 'var(--font-headline)', fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 800, lineHeight: 1.1, margin: "0 0 6px", letterSpacing: "-.02em" }}>{p.headline}</h2>
                  {p.subheadline && <p style={{ fontFamily: 'var(--font-headline)', fontSize: 18, fontStyle: "italic", color: "#000000", margin: 0 }}>{p.subheadline}</p>}
                  <p style={{ fontFamily: "var(--font-subhead)", fontSize: 11, fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#000000", margin: "10px 0 0" }}>By {p.byline}</p>
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ fontFamily: 'var(--font-headline)', fontSize: 22, fontStyle: "italic", color: "#000000" }}>No stories found for "{searchQuery}".</p>
          )}
        </section>
      )}

      {/* HERO */}
      {!q && hero && (
        <div className="hm-hero-wrap">
        <Link href={`/stories/${hero.slug}`} className="hm-hero-link">
          <div className="hm-hero">
            {heroImg && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="hm-hero-img" src={heroImg} alt={hero.image?.alt ?? hero.headline} />
            )}
          </div>
          {hero.image?.caption && <div className="hm-hero-credit-below">{hero.image.caption}</div>}
          {/* Headline, dek and byline sit below the photo on every breakpoint —
              a magazine-cover stack rather than a text overlay on the image. */}
          <div className="hm-hero-below">
            <span className="hm-kicker hm-kicker-below">Worth Your Time</span>
            <h1 className="hm-h1-below">{hero.headline}</h1>
            {hero.subheadline && <p className="hm-dek-below">{hero.subheadline}</p>}
            <div className="hm-hero-meta-below">
              <span>By {hero.byline}</span>
              <span className="hm-dot">·</span>
              <span>{postReadingTime(hero)} Min Read</span>
            </div>
          </div>
        </Link>
        </div>
      )}

      {/* LATEST FROM THE MAGAZINE */}
      {!q && cards.length > 0 && (
        <section className="hm-latest">
          <div className="hm-latest-head">
            <h2>Top Stories</h2>
            <Link href="/latest">View all stories →</Link>
          </div>
          <div className="hm-grid" ref={carouselRef} onScroll={onCarouselScroll}>
            {latestCards.map((post, i) => {
              const imgSrc = post.image?.asset
                ? urlFor(post.image.asset).width(720).height(540).fit("crop").auto("format").url()
                : null;
              return (
                <div key={post._id} style={{ display: "contents" }}>
                  {i > 0 && <div className="hm-divider" />}
                  <Link href={`/stories/${post.slug}`} className="hm-card">
                    <article>
                      <span className="hm-thumb">
                        {imgSrc
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={imgSrc} alt={post.image?.alt ?? post.headline} />
                          : <span style={{ display: "block", width: "100%", height: "100%", background: "#b8b8ba" }} />
                        }
                      </span>
                      <div className="hm-label">{sectionLabel(post.section)}</div>
                      <h3>{post.headline}</h3>
                      <div className="hm-byline">By {post.byline}</div>
                      <div className="hm-time">{postReadingTime(post)} Min Read</div>
                    </article>
                  </Link>
                </div>
              );
            })}
          </div>
          {latestCards.length > 1 && (
            <div className="hm-carousel-dots">
              {latestCards.map((post, i) => (
                <button
                  key={post._id}
                  className={`hm-carousel-dot${i === activeCard ? " active" : ""}`}
                  aria-label={`Go to card ${i + 1}`}
                  onClick={() => scrollToCard(i)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* LIFE, IN BRIEF */}
      {!q && (
        <div className="hm-brief-wrap">
        <section className="hm-brief">
          <div className="hm-brief-left">
            <div className="hm-brief-title">Life, in Brief.</div>
            <p className="hm-brief-sub">Short on time? We've got you.</p>
          </div>
          <div className="hm-circles">
            {[1, 3, 5].map(m => (
              <Link key={m} href={`/brief/${m}`} className="hm-circle">
                <strong>{m}</strong>
                <span>MIN</span>
              </Link>
            ))}
          </div>
          <Link href="/brief/1" className="hm-brief-caption">
            <span className="hm-arrow">←</span>
            <span>Stories that fit<br />your window.</span>
          </Link>
        </section>
        </div>
      )}

      <MagFooter />
    </>
  );
}
