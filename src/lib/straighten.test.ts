import { describe, it, expect } from "vitest";
import { straightenQuotes, straightenBlocks } from "./straighten";

describe("straightenQuotes", () => {
  it("converts curly single quotes and apostrophes to straight", () => {
    expect(straightenQuotes("it’s")).toBe("it's");
    expect(straightenQuotes("‘hello’")).toBe("'hello'");
  });

  it("converts curly double quotes to straight", () => {
    expect(straightenQuotes("“hello”")).toBe('"hello"');
  });

  it("leaves already-straight quotes untouched", () => {
    expect(straightenQuotes(`it's "fine"`)).toBe(`it's "fine"`);
  });

  it("leaves em dashes and ellipses alone (scoped to quotes only)", () => {
    expect(straightenQuotes("wait—no…")).toBe("wait—no…");
  });

  it("handles mixed curly quote variants in one string", () => {
    // low-9, high-reversed-9, prime, modifier apostrophe
    expect(straightenQuotes("‚hi‛ ′x‵ ʼʻʽ＇")).toBe("'hi' 'x' ''''");
  });
});

describe("straightenBlocks", () => {
  it("straightens text in every span of every block", () => {
    const blocks = [
      { _type: "block", children: [{ text: "“Quoted” and it’s" }] },
      { _type: "block", children: [{ text: "no curls here" }] },
    ];
    const result = straightenBlocks(blocks);
    expect(result[0].children[0].text).toBe('"Quoted" and it\'s');
    expect(result[1].children[0].text).toBe("no curls here");
  });

  it("does not mutate the input array", () => {
    const blocks = [{ _type: "block", children: [{ text: "’" }] }];
    const original = JSON.parse(JSON.stringify(blocks));
    straightenBlocks(blocks);
    expect(blocks).toEqual(original);
  });

  it("passes through non-array input unchanged", () => {
    expect(straightenBlocks(null)).toBe(null);
  });

  it("leaves blocks without a children array untouched", () => {
    const blocks = [{ _type: "imageEmbed", src: "/media/x.jpg" }];
    expect(straightenBlocks(blocks)).toEqual(blocks);
  });
});
