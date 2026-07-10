import { describe, expect, it } from "vitest";

import { parseDocumentLines, tokenizeLine } from "../../../src/parser";

describe("parser tokenizer branch behavior", () => {
  it("skips undefined document lines defensively", () => {
    expect(
      parseDocumentLines(["global", undefined as never, "    daemon"])[2]?.tokens[0]?.text,
    ).toBe("daemon");
  });

  it("keeps quotes inside unquoted tokens", () => {
    expect(tokenizeLine('prefix"quoted"')).toEqual([{ text: 'prefix"quoted"', start: 0, end: 14 }]);
  });
});
