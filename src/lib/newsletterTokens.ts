// Single source of truth for design values shared between the newsletter
// EMAIL renderer (src/lib/newsletterEmail.ts) and the newsletter EDITOR canvas
// (src/app/admin/NewsletterEditorClient.tsx). These two are still separate
// implementations — one emits raw HTML strings, the other is an interactive
// React canvas — so a full merge isn't safe (it would risk cursor/focus/drag
// state in the editor). But every value that has drifted between them so far
// (torn-clip polygons, tape rotation, headline size, palette) was a plain
// copy-pasted magic number edited in only one place. Importing from here
// instead of hardcoding a duplicate makes that specific failure mode
// impossible: change a value once, both surfaces follow.
//
// Anything ADDED to either file that the other should visually match belongs
// here, not as a local const in either file.

export const NL_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const NL_SERIF = "Georgia, 'Times New Roman', serif";

export const NL_GROUND = "#000000"; // whole-email ground, cover, footer
export const NL_PAPER = "#ffffff";  // article sheets, tweet card, clipping paper
export const NL_EARTH = "#392a22";  // decks, bylines, captions, meta
export const NL_RULE = "#b8b8ba";   // keylines, kickers-on-black, tweet borders
export const NL_TAPE = "rgba(233,230,225,0.5)";

// Headline size/line-height — shared across Essays/Narratives/Archive so
// nothing renders at a different scale in the editor than in the sent email.
export const NL_HEAD_SIZE_PX = 30;
export const NL_HEAD_LINE = 1.15;

// Archive "Gangrey Classics" torn-clipping look. Two variants, alternated by
// an archive-only ordinal (not overall card position — see the ordinal
// comment at each call site). Amplitude is fixed PIXELS, not percent — a
// percentage-based clip-path made a short blank card's tear subtle and a long
// photo+body card's tear an exaggerated sawtooth (the same 1-2% notch is a
// couple of px on a short card, a dozen+ px on a tall one), which also threw
// off the tape strips' fixed-pixel placement. Keeping this here means the
// polygon math only exists once instead of two hand-copied arrays that can
// silently diverge (this exact pair drifted apart earlier this session).
export const NL_TORN_CLIP_PATHS = [
  "polygon(0% 8px,6% 3px,12% 10px,18% 4px,24% 8px,31% 2px,38% 11px,45% 5px,52% 3px,59% 10px,66% 4px,73% 9px,80% 3px,87% 11px,94% 5px,100% 4px,100% calc(100% - 4px),94% calc(100% - 7px),87% calc(100% - 3px),80% calc(100% - 7px),73% calc(100% - 3px),66% calc(100% - 8px),59% calc(100% - 3px),52% calc(100% - 6px),45% calc(100% - 3px),38% calc(100% - 8px),31% calc(100% - 4px),24% calc(100% - 7px),18% calc(100% - 3px),12% calc(100% - 7px),6% calc(100% - 3px),0% calc(100% - 6px))",
  "polygon(0% 6px,7% 2px,13% 10px,19% 4px,26% 9px,33% 3px,39% 11px,46% 4px,53% 3px,60% 10px,67% 4px,74% 8px,81% 3px,88% 10px,95% 4px,100% 7px,100% calc(100% - 6px),95% calc(100% - 3px),88% calc(100% - 7px),81% calc(100% - 3px),74% calc(100% - 7px),67% calc(100% - 4px),60% calc(100% - 8px),53% calc(100% - 3px),46% calc(100% - 6px),39% calc(100% - 3px),33% calc(100% - 7px),26% calc(100% - 4px),19% calc(100% - 7px),13% calc(100% - 3px),7% calc(100% - 6px),0% calc(100% - 4px))",
] as const;

// Tape-strip rotation for each clip variant, [left, right].
export const NL_TAPE_ROTATIONS = [
  ["-6deg", "5deg"],
  ["-5deg", "6deg"],
] as const;

// Uniform photo aspect ratio across every card type (Essays/Narratives/
// Micro-Memoir/Archive) — was previously a different max-height per card.
export const NL_PHOTO_ASPECT_RATIO = "16/9";

// Section kicker labels, keyed by the same effective card type both files use.
export const NL_SECTION_LABEL: Record<"narratives" | "essays" | "micro-memoir" | "archive", string> = {
  narratives: "NARRATIVES",
  essays: "ESSAYS",
  "micro-memoir": "MICRO-MEMOIR",
  archive: "FROM THE ARCHIVE",
};
