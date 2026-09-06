import type { Metadata } from "next";
import Link from "next/link";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";

export const metadata: Metadata = {
  title: "The Tampa Tribune | Thank You",
  robots: { index: false, follow: false },
};

export default function SubscribeSuccessPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <MagHeader />
      <main style={{ flex: 1, width: "100%", maxWidth: 640, margin: "0 auto", padding: "80px 24px", textAlign: "center", boxSizing: "border-box" }}>
        <h1 style={{ fontFamily: "var(--font-headline)", fontSize: "clamp(32px, 5vw, 44px)", fontWeight: 800, letterSpacing: "-.03em", margin: "0 0 18px" }}>
          Welcome to The Tampa Tribune.
        </h1>
        <p style={{ fontFamily: "var(--font-body)", fontSize: 18, lineHeight: 1.5, color: "#392a22", margin: "0 0 32px" }}>
          Your membership is confirmed. A receipt is on its way to your inbox, and your next issue will follow soon.
        </p>
        <Link href="/" style={{ fontFamily: "var(--font-subhead)", fontWeight: 700, fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: "#490000" }}>
          ← Back to The Tampa Tribune
        </Link>
      </main>
      <MagFooter />
    </div>
  );
}
