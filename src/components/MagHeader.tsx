"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function MagHeader({ onLogoClick }: { onLogoClick?: () => void }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  function openSearch() { setSearchOpen(true); }
  function closeSearch() { setSearchOpen(false); setSearchQ(""); }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchQ.trim()) {
      router.push(`/?q=${encodeURIComponent(searchQ.trim())}`);
      closeSearch();
    }
  }

  const logoInner = (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="mag-wordmark-img" src="/Wordmark.png?v=9" alt="The Sunland Tribune" fetchPriority="high" decoding="sync" />
  );

  return (
    <header className={`mag-header${menuOpen ? " open" : ""}${searchOpen ? " search-open" : ""}`}>
      <style>{`
        .mag-header {
          background: #ffffff;
          position: sticky;
          top: 0;
          z-index: 20;
        }

        /* ---- Masthead: wordmark / vol-no bar ---- */
        .mag-masthead { padding: 8px 32px 0; max-width: 1290px; margin: 0 auto; box-sizing: border-box; }
        .mag-wordmark-link { display: block; width: fit-content; margin: 2px auto 8px; line-height: 0; background: none; border: none; padding: 0; cursor: pointer; }
        .mag-wordmark-img { display: block; height: clamp(44px, 6.3vw, 64px); width: auto; margin: 0 auto; }
        .mag-volno {
          border-top: 1px solid #000000;
          border-bottom: 2px solid #490000;
          padding: 5px 0;
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 6px 16px;
          font-family: var(--font-subhead);
          font-weight: 700;
          /* Nudge up from 9px so the masthead dateline reads at the site's
             small-label scale (~11px) instead of feeling shrunken. */
          font-size: 11px;
          letter-spacing: .14em;
          text-transform: uppercase;
          color: #000000;
        }
        .mag-volno .tag { color: #490000; text-align: center; flex: 1 1 auto; }

        /* ---- Nav row ---- */
        .mag-nav {
          height: 42px;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          padding: 0 32px;
          max-width: 1290px;
          margin: 0 auto;
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
        }
        .mag-nav-group {
          display: flex;
          gap: clamp(16px, 2vw, 28px);
          align-items: center;
          font-family: var(--font-subhead);
          /* Match the footer nav (12px / 800 / .2em) — same element type, so
             the site's primary navigation reads at a consistent size. */
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .2em;
          text-transform: uppercase;
          color: #000000;
          white-space: nowrap;
        }
        .mag-nav-group a { color: inherit; text-decoration: none; transition: color .15s; }
        .mag-nav-group a:hover { color: #490000; }
        .mag-nav-group.right { justify-content: flex-end; gap: clamp(14px, 1.5vw, 20px); }
        .mag-nav-cta {
          color: #490000 !important;
          background: none;
          border: none;
          padding: 0;
          font-family: var(--font-subhead);
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .2em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .mag-search-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          color: #000000;
          display: flex;
          align-items: center;
          transition: color .15s;
        }
        .mag-search-btn:hover { color: #490000; }

        /* Inline search — expands in place of the search icon, next to the
           rest of the nav, instead of covering the whole bar. */
        .mag-search-inline {
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #b8b8ba;
          border-radius: 16px;
          padding: 3px 12px;
          background: #fff;
          flex: 0 1 260px;
          min-width: 0;
        }
        .mag-search-inline input {
          flex: 1;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          font-family: var(--font-subhead);
          font-size: 12px;
          color: #000000;
        }
        /* Hide WebKit's built-in clear (×) on type=search — we render our own,
           so without this there are two clear buttons. */
        .mag-search-inline input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
        .mag-search-inline input::placeholder { color: #b8b8ba; }
        .mag-search-cancel {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          color: #8a8a8c;
          flex-shrink: 0;
          padding: 0;
          transition: color .15s;
        }
        .mag-search-cancel:hover { color: #490000; }

        .mag-toggle { display: none; }
        .mag-drawer { display: none; }
        .mag-nav-right-mobile { display: none; }

        @media (max-width: 700px) {
          .mag-wordmark-img { height: 38px; }
        }
        @media (max-width: 1100px) {
          .mag-masthead { padding: 10px 20px 0; }
          .mag-wordmark-link { margin: 4px auto 6px; }
          .mag-volno { flex-wrap: nowrap; font-size: 7.5px; letter-spacing: .02em; gap: 5px; padding: 5px 0; }
          .mag-volno .tag { white-space: nowrap; }

          .mag-nav {
            height: auto;
            padding: 8px 20px;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
          }
          .mag-nav-group { display: none; }
          .mag-search-bar { padding: 0 20px; }
          .mag-toggle {
            display: flex;
            align-items: center;
            justify-content: center;
            background: none;
            border: none;
            cursor: pointer;
            color: #000000;
            padding: 6px 8px 6px 0;
          }
          .mag-nav-right-mobile {
            display: flex;
            align-items: center;
            gap: 16px;
            flex: 1;
            justify-content: flex-end;
            min-width: 0;
          }
          .mag-nav-right-mobile .mag-search-inline { flex: 1 1 auto; }
          .mag-mob-sub {
            display: block;
            font-family: var(--font-subhead);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .14em;
            text-transform: uppercase;
            color: #490000;
            background: none;
            padding: 0;
            border: none;
            cursor: pointer;
          }
          .mag-drawer {
            flex-direction: column;
            width: 100%;
            padding: 6px 0 20px;
          }
          .mag-drawer a {
            font-family: var(--font-subhead);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: #000000;
            padding: 12px 4px;
            display: block;
            text-decoration: none;
          }
          .mag-header.open .mag-drawer { display: flex; }
        }
      `}</style>

      <div className="mag-masthead">
        {onLogoClick ? (
          <button className="mag-wordmark-link" onClick={onLogoClick} aria-label="Home">{logoInner}</button>
        ) : (
          <Link href="/" className="mag-wordmark-link" aria-label="Home">{logoInner}</Link>
        )}
        <div className="mag-volno">
          <span>Vol. I &middot; No. 1</span>
          <span className="tag">Prolonging the Slow Death of Newspapers</span>
          <span>Est. 2026</span>
        </div>
      </div>

      <div className="mag-nav">
        <nav className="mag-nav-group">
          <Link href="/about">About</Link>
          <Link href="/latest">The Latest</Link>
          <Link href="/archive">Archive</Link>
          <Link href="/issues">Issues</Link>
          <Link href="/store">Shop</Link>
        </nav>

        <nav className="mag-nav-group right">
          {searchOpen ? (
            <form className="mag-search-inline" onSubmit={submitSearch}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8a8a8c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={searchInputRef}
                type="search"
                placeholder={`Try "Tampa"`}
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                autoComplete="off"
              />
              <button type="button" className="mag-search-cancel" onClick={closeSearch} aria-label="Cancel search">×</button>
            </form>
          ) : (
            <button className="mag-search-btn" aria-label="Search" onClick={openSearch}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
          )}
          <Link href="/subscribe" className="mag-nav-cta">Subscribe</Link>
        </nav>

        {/* Mobile */}
        <button className="mag-toggle" aria-label={menuOpen ? "Close menu" : "Menu"} onClick={() => setMenuOpen(o => !o)}>
          {menuOpen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
        <div className="mag-nav-right-mobile">
          {searchOpen ? (
            <form className="mag-search-inline" onSubmit={submitSearch}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8a8a8c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="search"
                placeholder={`Try "Tampa"`}
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                autoComplete="off"
              />
              <button type="button" className="mag-search-cancel" onClick={closeSearch} aria-label="Cancel search">×</button>
            </form>
          ) : (
            <>
              <button className="mag-search-btn" aria-label="Search" onClick={openSearch}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </button>
              <Link href="/subscribe" className="mag-mob-sub">Subscribe</Link>
            </>
          )}
        </div>
        <div className="mag-drawer">
          <Link href="/about" onClick={() => setMenuOpen(false)}>About</Link>
          <Link href="/latest" onClick={() => setMenuOpen(false)}>The Latest</Link>
          <Link href="/archive" onClick={() => setMenuOpen(false)}>Archive</Link>
          <Link href="/issues" onClick={() => setMenuOpen(false)}>Issues</Link>
          <Link href="/store" onClick={() => setMenuOpen(false)}>Shop</Link>
        </div>
      </div>
    </header>
  );
}
