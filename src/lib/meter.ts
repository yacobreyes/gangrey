// Metered paywall config + helpers. Non-members may read a few members-only
// stories per month before the wall; a first-party cookie identifies the
// visitor cookielessly (a random id, no PII).
export const METER_COOKIE = "gm_id";
export const METER_LIMIT = Number(process.env.METER_LIMIT) || 3;

// Current month key in the newsroom's timezone (ET), so the meter resets on
// the reader's calendar month, not the server's UTC one.
export function meterMonth(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).slice(0, 7);
}
