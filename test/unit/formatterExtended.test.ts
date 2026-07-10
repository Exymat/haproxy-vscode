import { formatConfig, splitLineAtComment } from "../../src/formatter";
import { formatOptionsWithSchema } from "../helpers/formatOptions";

const formatOptions = formatOptionsWithSchema("3.2");

describe("formatter edge cases", () => {
  it("preserves blank lines", () => {
    expect(formatConfig("global\n\n    daemon", formatOptions)).toBe("global\n\n    daemon");
  });

  it("handles comment-only lines", () => {
    expect(formatConfig("    # note", formatOptions)).toBe("# note");
  });

  it("handles whitespace-only lines", () => {
    expect(formatConfig("global\n   \n    daemon", formatOptions)).toBe("global\n\n    daemon");
  });

  it("handles escaped quotes in splitLineAtComment", () => {
    const split = splitLineAtComment('mode "a\\"b" # comment');
    expect(split.code).toBe('mode "a\\"b"');
    expect(split.commentSuffix).toBe("# comment");
  });

  it("handles code-only whitespace and comment-only token lines", () => {
    expect(formatConfig("global\n    \t   # note", formatOptions)).toBe("global\n# note");
    expect(formatConfig("global\n# only", formatOptions)).toBe("global\n# only");
  });
});
