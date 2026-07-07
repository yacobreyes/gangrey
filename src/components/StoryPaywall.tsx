import Link from "next/link";

// Shown in place of the rest of a members-only story for non-members. Sits
// below the preview paragraphs with a soft fade so it reads as "keep reading."
export default function StoryPaywall() {
  return (
    <div className="story-paywall">
      <style>{`
        .story-paywall {
          position: relative;
          margin-top: -80px;
          padding-top: 80px;
          text-align: center;
        }
        .story-paywall::before {
          content: "";
          position: absolute; top: 0; left: 0; right: 0; height: 80px;
          background: linear-gradient(to bottom, rgba(255,255,255,0), #ffffff 92%);
          pointer-events: none;
        }
        .story-paywall-inner {
          border-top: 1px solid #b8b8ba;
          padding: 28px 0 8px;
        }
        .story-paywall-title {
          font-family: var(--font-headline);
          font-size: clamp(24px, 4vw, 32px); font-weight: 800; letter-spacing: -.02em;
          line-height: 1.1; margin: 0 0 12px;
        }
        .story-paywall-sub {
          font-family: var(--font-body);
          font-size: 16px; line-height: 1.5; color: #392a22; margin: 0 auto 22px; max-width: 420px;
        }
        .story-paywall-cta {
          display: inline-block;
          background: #490000; color: #fff; text-decoration: none;
          padding: 12px 24px; border-radius: 2px;
          font-family: var(--font-subhead);
          font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
        }
        .story-paywall-signin {
          display: block; margin-top: 16px;
          font-family: var(--font-subhead);
          font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
          color: #8a8a8c; text-decoration: none;
        }
      `}</style>
      <div className="story-paywall-inner">
        <h2 className="story-paywall-title">Keep reading with a membership</h2>
        <p className="story-paywall-sub">
          This story is for Gangrey members. Join to read it in full, unlock the archive, and support narrative nonfiction.
        </p>
        <Link href="/subscribe" className="story-paywall-cta">Become a Member</Link>
        <Link href="/account" className="story-paywall-signin">Already a member? Sign in</Link>
      </div>
    </div>
  );
}
