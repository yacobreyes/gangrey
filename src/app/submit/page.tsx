import type { Metadata } from "next";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import ListingHeader from "@/components/ListingHeader";
import SubmitForm from "./SubmitForm";

export const metadata: Metadata = {
  title: "Gangrey | Submit",
  description: "Submit a true story to Gangrey — essays, reported narratives, and micro-memoirs.",
  alternates: { canonical: "/submit" },
};

export default function SubmitPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <MagHeader />
      <main style={{ width: "100%", maxWidth: 1290, margin: "0 auto", padding: "20px 32px 80px", boxSizing: "border-box", flex: 1 }}>
        <ListingHeader
          title="Submit"
          sub="Gangrey publishes true stories. We read every submission ourselves."
          marginBottom={32}
        />

        <div style={{ display: "flex", gap: 56, flexWrap: "wrap-reverse", alignItems: "flex-start" }}>
          {/* Form */}
          <div style={{ flex: "2 1 520px", minWidth: 0 }}>
            <SubmitForm />
          </div>

          {/* Guidelines rail */}
          <aside style={{ flex: "1 1 240px", fontFamily: "var(--font-body)", fontSize: 14.5, lineHeight: 1.6, color: "#392a22" }}>
            <h2 style={{ fontFamily: "var(--font-subhead)", fontSize: 11, fontWeight: 800, letterSpacing: ".18em", textTransform: "uppercase", color: "#490000", margin: "0 0 12px" }}>
              What we&apos;re looking for
            </h2>
            <p style={{ margin: "0 0 14px" }}>
              True, well-told stories. We publish in three forms:
            </p>
            <ul style={{ margin: "0 0 18px", paddingLeft: 18 }}>
              <li style={{ marginBottom: 8 }}><strong>Essays</strong>, a mind at work on the page. <span style={{ color: "#8a8a8c" }}>1,000 words max.</span></li>
              <li style={{ marginBottom: 8 }}><strong>Reported Narratives</strong>, scenes, characters, and reporting. <span style={{ color: "#8a8a8c" }}>400 words max.</span></li>
              <li style={{ marginBottom: 8 }}><strong>Micro-Memoirs</strong>, a whole life in a breath. <span style={{ color: "#8a8a8c" }}>100 words max.</span></li>
            </ul>
            <p style={{ margin: "0 0 14px" }}>
              Send us your best single piece. Paste the full text — no attachments needed. A short cover letter helps but isn&apos;t required.
            </p>
            <p style={{ margin: 0 }}>
              We read everything and reply either way. Simultaneous submissions are fine; just tell us if it&apos;s placed elsewhere.
            </p>
          </aside>
        </div>
      </main>
      <MagFooter />
    </div>
  );
}
