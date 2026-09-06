// Shared shell for the transactional submission emails (confirmation + the
// editor's accept/decline reply) — a real card treatment matching the site's
// brand (wordmark, crimson rule, warm grey ground) instead of a bare paragraph
// on white. Hard light-mode lock so dark-mode clients can't recolor the
// crimson or invert the background.

const SITE_URL = "https://www.gangrey.org";
const CRIMSON = "#490000";
const RULE = "#b8b8ba";
const GROUND = "#f4f4f5";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function submissionEmailHtml(innerHtml: string, kicker?: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<style>:root{color-scheme:light only;supported-color-schemes:light only;}</style>
</head>
<body style="margin:0;padding:0;background-color:${GROUND};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GROUND};border-collapse:collapse;">
    <tr><td align="center" style="padding:36px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border:1px solid ${RULE};border-collapse:collapse;">
        <tr><td style="padding:32px 34px 8px;text-align:center;">
          <img src="${SITE_URL}/Wordmark.png?v=8" alt="The Tampa Tribune" width="150" style="width:150px;max-width:60%;display:block;margin:0 auto 16px;border:0;" />
          <div style="width:36px;height:2px;background-color:${CRIMSON};margin:0 auto;"></div>
          ${kicker ? `<div style="font-family:${SERIF};font-size:22px;font-weight:700;color:${CRIMSON};margin:18px 0 0;">${escapeHtml(kicker)}</div>` : ""}
        </td></tr>
        <tr><td style="padding:20px 34px 30px;font-family:${SERIF};color:#000000;">
          ${innerHtml}
        </td></tr>
      </table>
      <p style="font-family:${SANS};font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8a8a8c;text-align:center;margin:20px 0 0;">The Tampa Tribune &middot; A Literary Magazine</p>
    </td></tr>
  </table>
</body></html>`;
}
