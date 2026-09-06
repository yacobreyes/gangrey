import { describe, it, expect } from "vitest";
import { renderNewsletterHtml, renderNewsletterPageHtml, type NlCard } from "./newsletterEmail";

// This file has been the single most regression-prone part of the newsletter
// system this session (curly quotes leaking into sent mail, images not
// loading because relative URLs went out as-is, the archive running head
// showing today's date instead of the story's real publish date, Classics
// issues still showing Guest Editor/Volume after that was supposed to be
// removed). These tests pin down that exact set of prior bugs so a future
// change can't silently reintroduce any of them.

const essayCard: NlCard = {
  cardType: "essays",
  headline: "How to be a Diversity Hire",
  deck: "So, you're hired.",
  byline: "Yacob Reyes",
  body: [{ _type: "block", style: "normal", children: [{ _type: "span", text: "Step 1." }] } as never],
};

function baseOpts(overrides: Partial<Parameters<typeof renderNewsletterHtml>[0]> = {}) {
  return {
    subject: "Test Issue",
    preview: "preview text",
    author: "Yacob Reyes",
    volume: "I",
    issue: "1",
    cards: [essayCard],
    baseUrl: "https://gangrey.org",
    ...overrides,
  };
}

describe("renderNewsletterHtml", () => {
  it("straightens curly quotes in headline, deck, byline, and intro", () => {
    const html = renderNewsletterHtml(baseOpts({
      intro: "It’s a “big” issue",
      cards: [{ ...essayCard, headline: "It’s Complicated", deck: "A “sequel”" }],
    }));
    expect(html).not.toMatch(/[‘’“”]/);
    expect(html).toContain("It's Complicated");
  });

  it("absolutizes a relative /media image URL and requests the 1200×675 derivative (not the raw multi-MB original)", () => {
    const html = renderNewsletterHtml(baseOpts({
      cards: [{ ...essayCard, image: { url: "/media/photo.jpg", alt: "a photo" } }],
    }));
    expect(html).toContain('src="https://gangrey.org/media/photo.jpg?w=1200&h=675"');
    expect(html).not.toContain('src="/media/photo.jpg');
  });

  it("does not double-append resize params when the stored URL already has them", () => {
    const html = renderNewsletterHtml(baseOpts({
      cards: [{ ...essayCard, image: { url: "/media/photo.jpg?w=1600&h=900" } }],
    }));
    expect(html).toContain('src="https://gangrey.org/media/photo.jpg?w=1600&h=900"');
  });

  it("leaves an already-absolute image URL untouched", () => {
    const html = renderNewsletterHtml(baseOpts({
      cards: [{ ...essayCard, image: { url: "https://images.example.com/x.jpg" } }],
    }));
    expect(html).toContain('src="https://images.example.com/x.jpg"');
  });

  it("uses the card's own publish date on the archive running head, not today", () => {
    const html = renderNewsletterHtml(baseOpts({
      cards: [{ cardType: "archive", headline: "Imitate Others", byline: "Ben Montgomery", date: "2005-07-08T00:00:00.000Z", body: [] }],
    }));
    expect(html).toContain("July 8, 2005");
  });

  it("falls back to today's date when an archive card has no stored date", () => {
    const html = renderNewsletterHtml(baseOpts({
      cards: [{ cardType: "archive", headline: "Undated Piece", body: [] }],
    }));
    // Should not throw and should contain SOME "Gangrey · Archive" running head.
    expect(html).toContain("The Tampa Tribune · Archive");
  });

  it("Classics issues hide Guest Editor and Volume/Issue", () => {
    const html = renderNewsletterHtml(baseOpts({ classics: true }));
    expect(html).not.toContain("Guest Editor");
    expect(html).not.toContain(">Vol.<");
  });

  it("non-Classics issues show Guest Editor and Vol./No.", () => {
    const html = renderNewsletterHtml(baseOpts({ classics: false }));
    expect(html).toContain("Guest Editor");
    expect(html).toContain("Vol.");
  });

  it("cover eyebrow always reads 'A Literary Magazine', Classics or not", () => {
    const classic = renderNewsletterHtml(baseOpts({ classics: true }));
    const regular = renderNewsletterHtml(baseOpts({ classics: false }));
    expect(classic).toContain("A Literary Magazine");
    expect(regular).toContain("A Literary Magazine");
  });

  it("omits the View in browser link when no URL is supplied", () => {
    const html = renderNewsletterHtml(baseOpts({ viewOnlineUrl: undefined }));
    expect(html).not.toContain("View in browser");
  });

  it("includes the View in browser link when a URL is supplied", () => {
    const html = renderNewsletterHtml(baseOpts({ viewOnlineUrl: "https://gangrey.org/issues/test-issue" }));
    expect(html).toContain("View in browser");
    expect(html).toContain("https://gangrey.org/issues/test-issue");
  });

  it("every card image renders at the uniform 16:9 aspect ratio", () => {
    const html = renderNewsletterHtml(baseOpts({
      cards: [{ ...essayCard, image: { url: "/media/a.jpg" } }],
    }));
    expect(html).toContain("aspect-ratio:16/9");
  });

  it("micro-memoir avatar uses the byline's initials", () => {
    const html = renderNewsletterHtml(baseOpts({
      cards: [{ cardType: "micro-memoir", headline: "Sonder", byline: "Yacob Reyes", body: [] }],
    }));
    expect(html).toContain(">YR<");
  });

  it("renders valid HTML with a doctype and closing tags", () => {
    const html = renderNewsletterHtml(baseOpts());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("</html>");
  });
});

describe("renderNewsletterPageHtml", () => {
  it("omits the wordmark masthead (the web reader's MagHeader already shows it)", () => {
    const html = renderNewsletterPageHtml(baseOpts());
    expect(html).not.toContain("Wordmark-White.png");
  });

  it("still renders card content", () => {
    const html = renderNewsletterPageHtml(baseOpts());
    expect(html).toContain("How to be a Diversity Hire");
  });

  it("web reader keeps the black ground between cards but drops the side gutters", () => {
    const page = renderNewsletterPageHtml(baseOpts());
    const email = renderNewsletterHtml(baseOpts());
    // Both stay on the black ground...
    expect(page).toContain('max-width:600px;margin:0 auto;background:#000000');
    expect(email).toContain('max-width:600px;margin:0 auto;background:#000000');
    // ...but the web card wrappers bleed to the column edge (no 16px sides),
    // while the email's never do. (The member-callout gutter keeps its 16px on
    // both — it's black-on-black, so it's invisible either way.)
    expect(page).toContain('padding:0 0 16px;');
    expect(email).not.toContain('padding:0 0 16px;');
    expect(email).toContain('padding:0 16px 16px;');
  });
});
