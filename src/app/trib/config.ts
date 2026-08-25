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

// Feeds on the wall (any RSS/Atom works — add or remove freely)
export const NEWS_FEEDS: Record<string, string> = {
  "Creative Loafing": "https://www.cltampa.com/tampa/Rss.xml",
  "TB Business Jrnl": "https://www.bizjournals.com/tampabay/news/rss.xml",
  "Tampa Bay Times": "https://www.tampabay.com/arc/outboundfeeds/rss/?outputType=xml",
  "Florida Politics": "https://floridapolitics.com/feed/",
};

export const SUBREDDITS: string[] = ["tampa", "StPetersburgFL"];

export const CACHE_TTL = 1200; // seconds before a feed refetches (20 min)
