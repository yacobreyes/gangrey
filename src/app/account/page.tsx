import type { Metadata } from "next";
import Link from "next/link";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";
import MemberLoginForm from "./MemberLoginForm";
import { getCurrentMember } from "@/lib/currentMember";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Sunland Tribune | Your Membership",
  robots: { index: false, follow: false },
};

const TIER_LABEL: Record<string, string> = {
  monthly: "Monthly Member",
  annual: "Annual Member",
  founding: "Founding Member",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const current = await getCurrentMember();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ffffff", color: "#000000" }}>
      <MagHeader />
      <main style={{ flex: 1, width: "100%", maxWidth: 720, margin: "0 auto", padding: "20px 24px 80px", boxSizing: "border-box" }}>
        <div style={{ borderBottom: "1px solid #000000", paddingBottom: 16, marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-headline)", fontSize: "clamp(30px, 4.2vw, 40px)", fontWeight: 800, letterSpacing: "-.03em" }}>
            Your Membership
          </h1>
        </div>

        {current ? (
          <div>
            <p style={{ fontFamily: "var(--font-body)", fontSize: 17, lineHeight: 1.5, margin: "0 0 20px" }}>
              Signed in as <strong>{current.email}</strong>.
            </p>
            {current.active ? (
              <div style={{ background: "#f4f4f5", padding: "20px 22px", borderRadius: 4, marginBottom: 28 }}>
                <div style={{ fontFamily: "var(--font-subhead)", fontSize: 11, fontWeight: 800, letterSpacing: ".18em", textTransform: "uppercase", color: "#490000", marginBottom: 6 }}>
                  {TIER_LABEL[current.member?.tier ?? ""] ?? "Member"} · Active
                </div>
                <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 15, color: "#392a22", lineHeight: 1.5 }}>
                  You have full access to every story and issue. Thank you for supporting The Sunland Tribune.
                </p>
              </div>
            ) : (
              <div style={{ background: "#f4f4f5", padding: "20px 22px", borderRadius: 4, marginBottom: 28 }}>
                <p style={{ margin: "0 0 14px", fontFamily: "var(--font-body)", fontSize: 15, color: "#392a22", lineHeight: 1.5 }}>
                  {current.member
                    ? "Your membership isn't active right now. Renew to restore full access."
                    : "This email doesn't have an active membership yet."}
                </p>
                <Link href="/subscribe" style={{ fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#490000" }}>
                  View memberships →
                </Link>
              </div>
            )}
            <form action="/api/member/logout" method="post">
              <button type="submit" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "var(--font-subhead)", fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#000000" }}>
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <div>
            <p style={{ fontFamily: "var(--font-body)", fontSize: 17, lineHeight: 1.5, margin: "0 0 22px", maxWidth: 480 }}>
              Sign in with the email you used to subscribe.
            </p>
            {error === "expired" && (
              <p style={{ fontFamily: "var(--font-subhead)", fontSize: 13, color: "#490000", margin: "0 0 16px" }}>
                That sign-in link expired. Enter your email to get a new one.
              </p>
            )}
            <MemberLoginForm />
            <p style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "#8a8a8c", margin: "28px 0 0" }}>
              Not a member yet? <Link href="/subscribe" style={{ color: "#490000" }}>See membership options →</Link>
            </p>
          </div>
        )}
      </main>
      <MagFooter />
    </div>
  );
}
