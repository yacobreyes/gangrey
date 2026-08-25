// ---- tampatrib config -------------------------------------------------
// The password is NOT here: set TRIB_PASSWORD in .env.selfhost. Without it
// the /trib route 404s, so the tool does not exist until configured.

// Terms to flag anywhere they appear (names, streets, companies, projects).
export const WATCHLIST: string[] = [
  "Ybor", "Kennedy Blvd", "Rome Ave", "Armature Works",
  // add yours here…
];

// Radar thresholds
export const BIG_SALE = 1_000_000; // $ — deeds at/above this get the 💰 badge
export const NOMINAL_MAX = 100;    // $ — at/below reads as an LLC/trust shuffle
export const DEED_DAYS = 7;        // rolling window pulled from the Clerk


export const CACHE_TTL = 1200; // seconds before a feed refetches (20 min)


// Distress radar: Clerk doc types for pre-foreclosure/foreclosure activity.
// The Clerk's API wants its exact labels; candidates are tried in order until
// one answers with rows, and the winner is remembered for the process life.
export const DISTRESS_DOCTYPE_CANDIDATES: string[][] = [
  ["(LP) LIS PENDENS"],
  ["LIS PENDENS"],
  ["(LP) LIS PENDENS", "(JUD) JUDGMENT"],
];

// WARN layoff notices (FloridaCommerce). Probed in order.
export const WARN_URLS: string[] = [
  "https://floridajobs.org/office-directory/division-of-workforce-services/workforce-programs/reemployment-and-emergency-assistance-coordination-team-react/warn-notices",
  "https://www.floridajobs.org/office-directory/division-of-workforce-services/workforce-programs/reemployment-and-emergency-assistance-coordination-team-react/warn-notices",
];
