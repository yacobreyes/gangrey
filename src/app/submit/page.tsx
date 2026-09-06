import type { Metadata } from "next";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import ListingHeader from "@/components/ListingHeader";
import SubmitForm from "./SubmitForm";

export const metadata: Metadata = {
  title: "The Tampa Tribune | Submit",
  description: "Submit flash nonfiction to The Tampa Tribune: essays, reported narratives, and micro-memoirs.",
  alternates: { canonical: "/submit" },
};

const FORMS = [
  { name: "Essays", limit: "1,000 words max." },
  { name: "Reported Narratives", limit: "400 words max." },
  { name: "Micro-Memoirs", limit: "100 words max." },
];

// Small-caps crimson section labels for the guidelines, matching the site's
// kicker style (About page labels, story section flags).
const GUIDE_LABEL: React.CSSProperties = {
  fontFamily: "var(--font-subhead)", fontSize: 11, fontWeight: 800,
  letterSpacing: ".18em", textTransform: "uppercase", color: "#490000",
  margin: "0 0 6px",
};

export default function SubmitPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <MagHeader />
      <main style={{ width: "100%", maxWidth: 680, margin: "0 auto", padding: "20px 24px 88px", boxSizing: "border-box", flex: 1 }}>
        <ListingHeader title="Submit" marginBottom={28} />

        {/* Guidelines */}
        <p style={{ fontFamily: "var(--font-body)", fontSize: 17, lineHeight: 1.5, color: "#000000", margin: "0 0 20px" }}>
          We publish flash nonfiction in three forms:
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, margin: "0 0 24px" }}>
          {FORMS.map(f => (
            <div key={f.name} style={{ border: "1px solid #b8b8ba", borderRadius: 4, padding: "16px 18px" }}>
              <div style={{ fontFamily: "var(--font-headline)", fontSize: 17, fontWeight: 700, color: "#000000", marginBottom: 8, whiteSpace: "nowrap" }}>{f.name}</div>
              <div style={{ fontFamily: "var(--font-subhead)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "#490000" }}>{f.limit}</div>
            </div>
          ))}
        </div>

        {/* Submission guidelines */}
        <h2 style={{ fontFamily: "var(--font-headline)", fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", color: "#000000", margin: "8px 0 18px" }}>Submission Guidelines</h2>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 14.5, lineHeight: 1.6, color: "#392a22" }}>
          <h3 style={GUIDE_LABEL}>How to submit</h3>
          <p style={{ margin: "0 0 18px" }}>Paste the full text into the submission form, along with a short cover letter.</p>

          <h3 style={GUIDE_LABEL}>Eligibility</h3>
          <p style={{ margin: "0 0 18px" }}>We do not accept AI-generated writing. All work must be your own.</p>

          <h3 style={GUIDE_LABEL}>Simultaneous submissions</h3>
          <p style={{ margin: "0 0 18px" }}>Simultaneous submissions are welcome. Just let us know if the piece is placed elsewhere.</p>

          <h3 style={GUIDE_LABEL}>Rights and compensation</h3>
          <p style={{ margin: "0 0 10px" }}>Authors retain copyright to their work.</p>
          <p style={{ margin: "0 0 10px" }}>In accepting publication, the author grants us first serial rights and the nonexclusive right to archive and promote the piece.</p>
          <p style={{ margin: "0 0 32px" }}>For each accepted story, we provide a one-year membership plus an honorarium: $45 for reported narratives and essays, $25 for micro-memoirs.</p>
        </div>

        <div style={{ borderTop: "1px solid #000000", paddingTop: 28 }}>
          <SubmitForm />
        </div>
      </main>
      <MagFooter />
    </div>
  );
}
