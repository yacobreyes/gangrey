import NewsletterSignup from "./NewsletterSignup";

export default function SiteFooter() {
  return (
    <footer style={{
      background: "#490000",
      marginTop: "auto",
      padding: "2.5rem 1.5rem 2rem",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "1rem",
    }}>
      <NewsletterSignup />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wordmark.webp" alt="The Tampa Tribune" width={1772} height={1181} style={{ width: "clamp(150px, 18vw, 180px)", height: "auto", opacity: 0.9 }} />

      <p style={{ fontFamily: "var(--font-subhead)", fontSize: "0.7rem", color: "white", margin: 0, letterSpacing: "0.05em" }}>
        © 2026 The Tampa Tribune · Yacob Reyes
      </p>
    </footer>
  );
}
