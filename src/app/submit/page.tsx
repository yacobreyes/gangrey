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

const FORMS = [
  { name: "Essays", blurb: "A mind at work on the page.", limit: "1,000 words" },
  { name: "Reported Narratives", blurb: "Scenes, characters, reporting.", limit: "400 words" },
  { name: "Micro-Memoirs", blurb: "A whole life in a breath.", limit: "100 words" },
];

export default function SubmitPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <MagHeader />
      <main style={{ width: "100%", maxWidth: 680, margin: "0 auto", padding: "20px 24px 88px", boxSizing: "border-box", flex: 1 }}>
        <ListingHeader title="Submit" marginBottom={28} />

        {/* Guidelines — three cards, then the fine print */}
        <p style={{ fontFamily: "var(--font-body)", fontSize: 17, lineHeight: 1.5, color: "#000000", margin: "0 0 22px" }}>
          Gangrey publishes true, well-told stories in three forms. Send us your best single one.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, margin: "0 0 20px" }}>
          {FORMS.map(f => (
            <div key={f.name} style={{ border: "1px solid #b8b8ba", borderRadius: 4, padding: "14px 16px" }}>
              <div style={{ fontFamily: "var(--font-headline)", fontSize: 17, fontWeight: 700, color: "#000000", marginBottom: 4 }}>{f.name}</div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 13.5, lineHeight: 1.4, color: "#392a22", marginBottom: 8 }}>{f.blurb}</div>
              <div style={{ fontFamily: "var(--font-subhead)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "#490000" }}>{f.limit} max</div>
            </div>
          ))}
        </div>

        <p style={{ fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.6, color: "#392a22", margin: "0 0 32px" }}>
          Paste the full text below — no attachments. A short cover letter helps but isn&apos;t required. We read everything and reply either way. Simultaneous submissions are fine; just tell us if it&apos;s placed elsewhere.
        </p>

        <div style={{ borderTop: "1px solid #000000", paddingTop: 28 }}>
          <SubmitForm />
        </div>
      </main>
      <MagFooter />
    </div>
  );
}
