import type { Metadata } from "next";
import { PortableText } from "@portabletext/react";
import { getAboutPage } from "@/lib/sanity";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Gangrey | About",
  alternates: { canonical: "/about" },
  description: "About Gangrey, a literary magazine by Yacob Reyes.",
};

export default async function AboutPage() {
  let about = null as Awaited<ReturnType<typeof getAboutPage>>;
  try { about = await getAboutPage(); } catch {}
  const body = about?.body ?? [];

  return (
    <div className="about-page">
      <style>{`
        .about-page { min-height: 100vh; display: flex; flex-direction: column; background: #ffffff; color: #000000; }
        .about-main { flex: 1; width: 100%; max-width: 1290px; margin: 0 auto; padding: 20px 32px 42px; box-sizing: border-box; }
        .about-h1 {
          margin: 0; text-align: left;
          font-family: var(--font-headline);
          font-size: 38px; line-height: 1; letter-spacing: -.03em; font-weight: 800;
        }
        .about-body { margin-top: 34px; font-family: var(--font-body); font-size: 18.5px; line-height: 1.62; color: #000000; }
        .about-body p { margin: 0 0 20px; }
        .about-body a { color: #490000; text-decoration: underline; }
        .about-empty { margin-top: 34px; font-family: var(--font-headline); font-size: 22px; font-style: italic; color: #000000; text-align: left; }
        .about-cols {
          margin-top: 40px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          border-top: 3px solid #000000;
          padding-top: 24px;
        }
        .about-col-left { padding-right: 36px; border-right: 1px dotted #8a8a8c; }
        .about-col-right { padding-left: 36px; }
        .about-label {
          font-family: var(--font-subhead);
          font-weight: 800; font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
          color: #490000; margin-bottom: 10px;
        }
        .about-masthead { margin: 0; font-family: var(--font-body); font-size: 16px; line-height: 1.7; color: #000000; }
        .about-submit-p { margin: 0 0 16px; font-family: var(--font-body); font-size: 16px; line-height: 1.6; color: #000000; }
        .about-rights { margin: 0 0 16px; font-family: var(--font-body); font-size: 14px; line-height: 1.6; color: #392a22; }
        .about-submit-btn {
          display: inline-block; background: #490000; color: #ffffff;
          padding: 14px 26px;
          font-family: var(--font-subhead);
          font-weight: 700; font-size: 11px; letter-spacing: .16em; text-transform: uppercase;
          text-decoration: none;
        }
        @media (max-width: 900px) {
          .about-main { padding: 20px 20px 48px; }
          .about-h1 { font-size: clamp(30px, 9vw, 38px); }
          .about-cols { grid-template-columns: 1fr; }
          .about-col-left { padding-right: 0; border-right: 0; padding-bottom: 28px; border-bottom: 1px dotted #8a8a8c; }
          .about-col-right { padding-left: 0; padding-top: 28px; }
        }
      `}</style>
      <MagHeader />
      <main className="about-main">
        <h1 className="about-h1">About</h1>
        {body.length > 0 ? (
          <div className="about-body">
            <PortableText
              value={body}
              components={{
                block: {
                  normal: ({ children }) => <p>{children}</p>,
                  h2: ({ children }) => <h2 style={{ fontFamily: 'var(--font-headline)', fontWeight: 700, fontSize: "1.9rem", margin: "2rem 0 0", letterSpacing: "-.02em" }}>{children}</h2>,
                  h3: ({ children }) => <h3 style={{ fontFamily: 'var(--font-headline)', fontWeight: 700, fontSize: "1.5rem", margin: "1.7rem 0 0" }}>{children}</h3>,
                  blockquote: ({ children }) => <blockquote style={{ margin: "1.5rem 0 0", padding: "0.2rem 0 0.2rem 1.2rem", borderLeft: "3px solid #490000", fontStyle: "italic", color: "#000000" }}>{children}</blockquote>,
                },
                marks: {
                  strong: ({ children }) => <strong>{children}</strong>,
                  em: ({ children }) => <em>{children}</em>,
                  link: ({ children, value }) => <a href={value?.href} target="_blank" rel="noopener noreferrer">{children}</a>,
                },
              }}
            />
          </div>
        ) : (
          <p className="about-empty">Coming soon.</p>
        )}
        <div className="about-cols">
          <div className="about-col-left">
            <div className="about-label">Masthead</div>
            <p className="about-masthead">
              Patron Saint · Ben Montgomery<br />
              Editor-in-Chief · Yacob Reyes<br />
              Managing Editor · Sara Lindsay
            </p>
          </div>
          <div className="about-col-right">
            <div className="about-label">Submit</div>
            <p className="about-submit-p">We accept submissions throughout the year. Send us the full story, a brief note, and your bio.</p>
            <p className="about-rights">Authors retain copyright to their work. For each accepted piece, we provide a one-year membership and an honorarium: $45 for reported narratives and essays, $25 for micro-memoirs. In accepting publication, the author grants us first serial rights and the nonexclusive right to archive and promote the work.</p>
            <a className="about-submit-btn" href="/submit">Submit your work →</a>
          </div>
        </div>
      </main>
      <MagFooter />
    </div>
  );
}
