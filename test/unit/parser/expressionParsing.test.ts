import { describe, expect, it } from "vitest";

import {
  isIdChar,
  parseOneArg,
  readIdentifier,
  skipSpace,
} from "../../../src/parser/expressionParsing";

describe("expressionParsing", () => {
  it("skips whitespace", () => {
    expect(skipSpace("  foo", 0)).toBe(2);
  });

  it("reads identifiers", () => {
    expect(readIdentifier("  hdr(host)", 0)).toEqual({ name: "hdr", end: 5 });
  });

  it("detects identifier characters", () => {
    expect(isIdChar("a")).toBe(true);
    expect(isIdChar("(")).toBe(false);
  });

  it("parses quoted arguments", () => {
    const result = parseOneArg('"host name",next', 0);
    expect(result).toEqual({ arg: "host name", start: 0, end: 11 });
  });

  it("reports unclosed quotes", () => {
    const result = parseOneArg('"host', 0);
    expect("error" in result ? result.error.code : undefined).toBe("sample-syntax");
  });
});
