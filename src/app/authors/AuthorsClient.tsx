"use client";

import { useState, useMemo } from "react";
import ListingHeader from "@/components/ListingHeader";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type Author = { name: string; count: number; href?: string };

function lastNameInitial(name: string) {
  const last = name.trim().split(/\s+/).at(-1) ?? "";
  return last[0]?.toUpperCase() ?? "";
}

export default function AuthorsClient({ authors }: { authors: Author[] }) {
  const [letter, setLetter] = useState<string | null>(null); // null = All
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return authors.filter(a => {
      if (q) return a.name.toLowerCase().includes(q);
      if (!letter) return true;
      return lastNameInitial(a.name) === letter;
    });
  }, [authors, letter, query]);

  // Which letters have authors
  const available = useMemo(() => {
    const set = new Set<string>();
    for (const a of authors) {
      const init = lastNameInitial(a.name);
      if (init) set.add(init);
    }
    return set;
  }, [authors]);

  return (
    <div style={{ fontFamily: "var(--font-subhead)", color: "#000000" }}>
      <style>{`
        .au-search {
          flex: 0 0 220px; align-self: center; box-sizing: border-box;
          border: 1px solid #b8b8ba; border-radius: 2px; padding: 9px 12px;
          font-family: var(--font-subhead); font-size: 13px; color: #000000;
          background: #ffffff; outline: none;
        }
        .au-search::placeholder { color: #8a8a8c; }
        .au-search:focus { border-color: #490000; }
        .au-filter-row {
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 14px 20px; padding-top: 14px; margin-bottom: 20px;
        }
        .au-filter-label {
          font-family: var(--font-subhead); font-weight: 800; font-size: 10px;
          letter-spacing: .2em; text-transform: uppercase; color: #490000; margin-right: 18px;
        }
        .au-letters {
          display: inline-flex; flex-wrap: wrap; gap: 2px;
          font-size: 13px; font-weight: 600; letter-spacing: .04em;
        }
        .au-letter {
          background: none; border: none; font-family: inherit;
          font-size: 13px; font-weight: 600; letter-spacing: .04em;
          color: #000000; padding: 2px 4px; cursor: pointer; transition: color .12s;
        }
        .au-letter:hover:not(:disabled) { color: #490000; }
        .au-letter:disabled { color: #b8b8ba; cursor: default; }
        .au-letter.active { text-decoration: underline; text-underline-offset: 3px; }
        .au-list-wrap { border-top: 1px solid #000000; padding-top: 28px; }
        .au-grid { columns: 4; column-gap: 40px; font-size: 16px; line-height: 1.5; color: #000000; }
        .au-name {
          font-family: var(--font-body);
          font-size: 16px; line-height: 1.5; color: #000000;
          margin-bottom: 10px; break-inside: avoid;
        }
        .au-empty { font-family: var(--font-headline); font-style: italic; color: #392a22; margin: 12px 0 0; font-size: 18px; }
        @media (max-width: 900px) {
          .au-grid { columns: 2; }
          .au-search { flex: 1 1 100%; }
        }
      `}</style>

      <ListingHeader title="Authors" marginBottom={0} borderWidth={1} />

      {/* Filter row — alphabet jump list + search, under the shared title border */}
      <div className="au-filter-row">
        <span>
          <span className="au-filter-label">Filter by Last Name</span>
          <span className="au-letters">
            <button
              className={`au-letter${letter === null && !query ? " active" : ""}`}
              onClick={() => { setLetter(null); setQuery(""); }}
            >
              All
            </button>
            {ALPHABET.map(l => (
              <button
                key={l}
                className={`au-letter${letter === l && !query ? " active" : ""}`}
                disabled={!available.has(l)}
                onClick={() => { setLetter(l); setQuery(""); }}
              >
                {l}
              </button>
            ))}
          </span>
        </span>
        <input
          className="au-search"
          type="search"
          placeholder="Search authors…"
          value={query}
          onChange={e => { setQuery(e.target.value); setLetter(null); }}
          aria-label="Search authors"
        />
      </div>

      {/* Author list */}
      <div className="au-list-wrap">
        {filtered.length === 0 ? (
          <p className="au-empty">No authors found.</p>
        ) : (
          <div className="au-grid">
            {filtered.map(a => (
              a.href
                ? <a key={a.name} href={a.href} className="au-name" style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 3 }}>{a.name}</a>
                : <div key={a.name} className="au-name">{a.name}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
