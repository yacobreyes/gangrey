import Link from "next/link";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";

// Branded 404. Without this, stray URLs (old links, Google guessing paths out
// of page text like the /yr and /mo pricing labels) fell through to Next's
// bare default. Still a real 404 status, so crawlers drop the URL; readers
// get somewhere to go.
export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <MagHeader />
      <main style={{ flex: 1, width: "100%", maxWidth: 680, margin: "0 auto", padding: "56px 24px 88px", boxSizing: "border-box", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 800, letterSpacing: ".18em", textTransform: "uppercase", color: "#490000", margin: "0 0 14px" }}>404</p>
        <h1 style={{ fontFamily: "var(--font-headline)", fontSize: "clamp(30px, 5vw, 44px)", fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.05, margin: "0 0 14px" }}>
          There is no story here.
        </h1>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 17, lineHeight: 1.55, color: "#392a22", margin: "0 0 30px" }}>
          The page you are after moved, never existed, or was quietly retired.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" style={{ fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#ffffff", background: "#490000", padding: "10px 18px", textDecoration: "none" }}>
            Front page
          </Link>
          <Link href="/archive" style={{ fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#490000", border: "1px solid #490000", padding: "9px 18px", textDecoration: "none" }}>
            Browse the archive
          </Link>
        </div>
      </main>
      <MagFooter />
    </div>
  );
}
