import type { Metadata } from "next";
import Link from "next/link";
import { getAllIssues } from "@/lib/sanity";
import MagHeader from "@/components/MagHeader";
import MagFooter from "@/components/MagFooter";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Gangrey | Issues",
  alternates: { canonical: "/issues" },
  description: "Every newsletter issue from Gangrey, a literary magazine.",
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function IssuesPage() {
  let issues = [] as Awaited<ReturnType<typeof getAllIssues>>;
  try { issues = await getAllIssues(); } catch {}

  return (
    <div className="issues-page">
      <style>{`
        .issues-page { min-height: 100vh; display: flex; flex-direction: column; background: #ffffff; color: #000000; }
        .issues-main { flex: 1; width: 100%; max-width: 1290px; margin: 0 auto; padding: 20px 32px 42px; box-sizing: border-box; }
        .issues-header { border-bottom: 1px solid #000000; padding-bottom: 18px; margin-bottom: 34px; }
        .issues-h1 {
          margin: 0;
          font-family: var(--font-headline);
          font-size: clamp(30px, 4vw, 36px);
          line-height: 1; letter-spacing: -.03em; font-weight: 800;
        }
        .issues-band {
          background: #490000; color: #ffffff;
          padding: 34px 40px;
          display: flex; align-items: center; justify-content: space-between;
          gap: 30px; flex-wrap: wrap;
          margin-bottom: 46px;
        }
        .issues-band-title {
          font-family: var(--font-headline);
          font-size: 30px; font-weight: 800; letter-spacing: -.02em; line-height: 1.08;
        }
        .issues-band-cta {
          color: #ffffff; white-space: nowrap; flex-shrink: 0;
          font-family: var(--font-subhead);
          font-weight: 800; font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
          text-decoration: underline; text-underline-offset: 4px;
        }
        .issues-recent-label {
          font-family: var(--font-subhead);
          font-weight: 800; font-size: 12px; letter-spacing: .2em; text-transform: uppercase;
          margin-bottom: 2px;
        }
        .issue-row {
          display: grid;
          grid-template-columns: 150px 1fr auto;
          gap: 0 28px;
          align-items: start;
          padding: 24px 0;
          border-bottom: 1px dotted #8a8a8c;
          text-decoration: none;
          color: inherit;
        }
        .issue-row:last-child { border-bottom: 0; }
        .issue-no {
          font-family: var(--font-subhead);
          font-weight: 800; font-size: 13px; letter-spacing: .05em;
          color: #490000; white-space: nowrap; padding-top: 4px;
        }
        .issue-title {
          display: block;
          font-family: var(--font-headline);
          font-size: 23px; font-weight: 800; letter-spacing: -.02em; line-height: 1.14;
          margin: 0;
        }
        .issue-desc {
          display: block;
          font-family: var(--font-body);
          font-size: 15.5px; color: #392a22; margin-top: 4px;
          line-height: 1.4;
        }
        .issue-read {
          font-family: var(--font-subhead);
          font-weight: 700; font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
          color: #490000; white-space: nowrap; padding-top: 6px;
        }
        .issues-empty {
          font-family: var(--font-headline);
          font-size: 22px; font-style: italic; color: #000000;
        }
        @media (max-width: 900px) {
          .issues-main { padding: 20px 20px 48px; }
          .issues-band { padding: 16px 18px; gap: 14px; margin-bottom: 34px; flex-wrap: nowrap; align-items: center; }
          .issues-band > div:first-child { flex: 0 1 auto; min-width: 0; }
          .issues-band-title { font-size: 16px; line-height: 1.1; }
          .issues-band-cta { font-size: 11px; }
          .issue-row { grid-template-columns: 1fr auto; gap: 6px 20px; }
          .issue-no { grid-column: 1 / -1; padding-top: 0; }
        }
      `}</style>
      <MagHeader />
      <main className="issues-main">
        <div className="issues-header">
          <h1 className="issues-h1">Issues</h1>
        </div>

        <div className="issues-band">
          <div><div className="issues-band-title">Read it in your inbox.</div></div>
          <Link href="/subscribe" className="issues-band-cta">Subscribe →</Link>
        </div>

        {issues.length > 0 ? (
          <>
            <div className="issues-recent-label">Recent Editions</div>
            {issues.map(issue => {
              const internalHref = issue.newsletterId && issue.slug ? `/issues/${issue.slug}` : null;
              const inner = (
                <>
                  <span className="issue-no">No. {issue.number} · {formatDate(issue.publishedAt)}</span>
                  <span>
                    <span className="issue-title">"{issue.title}"</span>
                    {issue.description && <span className="issue-desc">{issue.description}</span>}
                  </span>
                  <span className="issue-read">Read</span>
                </>
              );
              if (internalHref) {
                return <Link key={issue._id} href={internalHref} className="issue-row">{inner}</Link>;
              }
              if (issue.url) {
                return <a key={issue._id} href={issue.url} target="_blank" rel="noopener noreferrer" className="issue-row">{inner}</a>;
              }
              return (
                <div key={issue._id} className="issue-row">
                  <span className="issue-no">No. {issue.number} · {formatDate(issue.publishedAt)}</span>
                  <span>
                    <span className="issue-title">"{issue.title}"</span>
                    {issue.description && <span className="issue-desc">{issue.description}</span>}
                  </span>
                  <span />
                </div>
              );
            })}
          </>
        ) : (
          <p className="issues-empty">Issues coming soon.</p>
        )}
      </main>
      <MagFooter />
    </div>
  );
}
