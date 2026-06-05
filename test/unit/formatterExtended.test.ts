import { formatConfig, splitLineAtComment, DEFAULT_FORMAT_OPTIONS } from "../../src/formatter";

describe("formatter edge cases", () => {
  it("preserves blank lines", () => {
    expect(formatConfig("global\n\n    daemon", DEFAULT_FORMAT_OPTIONS)).toBe(
      "global\n\n    daemon",
    );
  });

  it("handles comment-only lines", () => {
    expect(formatConfig("    # note", DEFAULT_FORMAT_OPTIONS)).toBe("# note");
  });

  it("handles whitespace-only lines", () => {
    expect(formatConfig("global\n   \n    daemon", DEFAULT_FORMAT_OPTIONS)).toBe(
      "global\n\n    daemon",
    );
  });

  it("handles escaped quotes in splitLineAtComment", () => {
    const split = splitLineAtComment('mode "a\\"b" # comment');
    expect(split.code).toBe('mode "a\\"b"');
    expect(split.commentSuffix).toBe("# comment");
  });

  it("handles code-only whitespace and comment-only token lines", () => {
    expect(formatConfig("global\n    \t   # note", DEFAULT_FORMAT_OPTIONS)).toBe("global\n# note");
    expect(formatConfig("global\n# only", DEFAULT_FORMAT_OPTIONS)).toBe("global\n# only");
  });
});
