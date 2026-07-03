import Link from "next/link";

export default function MagFooter() {
  return (
    <footer className="mag-footer">
      <style>{`
        .mag-footer {
          padding: 38px 76px 42px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          text-align: center;
        }
        .mag-footer-links {
          display: flex;
          gap: 34px;
          justify-content: center;
          flex-wrap: wrap;
          font-family: var(--font-subhead);
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .2em;
          text-transform: uppercase;
          color: #000000;
        }
        .mag-footer-links a { color: inherit; text-decoration: none; }
        .mag-footer-links button { font: inherit; letter-spacing: inherit; text-transform: inherit; background: none; border: none; padding: 0; color: inherit; cursor: pointer; }
        .mag-footer-copy {
          font-family: var(--font-headline);
          font-size: 15px;
          color: #000000;
        }
        @media (max-width: 900px) {
          .mag-footer { padding: 32px 20px 26px; }
          .mag-footer-links { gap: 24px; }
        }
      `}</style>
      <nav className="mag-footer-links">
        <Link href="/authors">Authors</Link>
        <a href="mailto:submissions@gangrey.org">Submit</a>
        <Link href="/subscribe">Subscribe</Link>
      </nav>
      <p className="mag-footer-copy">© 2026 Gangrey | A Literary Magazine. All Rights Reserved.</p>
    </footer>
  );
}
