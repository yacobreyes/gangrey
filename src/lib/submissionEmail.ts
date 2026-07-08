// Shared shell for the transactional submission emails (confirmation + the
// editor's accept/decline reply), so both look identical and match the house
// email style: Georgia serif body + a small system-sans "Gangrey" sign-off,
// with a hard light-mode lock so dark-mode clients can't recolor the crimson
// sign-off or invert the white background.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function submissionEmailHtml(innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<style>:root{color-scheme:light only;supported-color-schemes:light only;}</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-collapse:collapse;"><tr><td align="center" style="padding:0;">
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:460px;margin:0 auto;padding:30px 24px;color:#000000;background-color:#ffffff;">
      ${innerHtml}
      <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#490000 !important;margin:26px 0 0;">Gangrey</p>
    </div>
  </td></tr></table>
</body></html>`;
}
