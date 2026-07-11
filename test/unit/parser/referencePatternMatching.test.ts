import { describe, expect, it } from "vitest";

import { findReferencePatternMatches } from "../../../src/parser/referencePatternMatching";
import { ReferencePattern } from "../../../src/schema/types";
import { ParsedToken } from "../../../src/parser";

function token(text: string, start: number): ParsedToken {
  return { text, start, end: start + text.length };
}

const sectionHeaderFromPattern: ReferencePattern = {
  match_tokens: ["*", "*", "from"],
  reference_kind: "defaults-profile",
  target_token_index: 3,
  scope: "section-header",
};

describe("findReferencePatternMatches", () => {
  it("matches section-header defaults-profile references with wildcard tokens", () => {
    const tokens = [token("frontend", 0), token("web", 9), token("from", 13), token("base", 18)];
    const hits = findReferencePatternMatches(tokens, sectionHeaderFromPattern);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.targetIndex).toBe(3);
    expect(hits[0]?.targetToken.text).toBe("base");
  });

  it("does not match when from is not immediately after the section name", () => {
    const tokens = [
      token("frontend", 0),
      token("web", 9),
      token("extra", 13),
      token("from", 19),
      token("base", 24),
    ];
    expect(findReferencePatternMatches(tokens, sectionHeaderFromPattern)).toEqual([]);
  });

  it("matches exact tokens when no wildcards are present", () => {
    const pattern: ReferencePattern = {
      match_tokens: ["cache-use"],
      reference_kind: "cache",
      target_token_index: 1,
      scope: "global",
    };
    const tokens = [token("cache-use", 4), token("images", 14)];
    const hits = findReferencePatternMatches(tokens, pattern);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.targetToken.text).toBe("images");
  });
});
