import { describe, expect, it } from "vitest";

import { formatConfigRange, preserveTokenSpacing } from "../../../src/formatting";
import { tokenizeLine } from "../../../src/parser";
import { formatOptionsWithSchema } from "../../helpers/formatOptions";

describe("range formatter", () => {
  const formatOptions = formatOptionsWithSchema("3.2");

  it("preserves intra-line spacing when formatting a range", () => {
    const input = [
      "global",
      "    maxconn         1000",
      "frontend web",
      "    mode             http",
    ].join("\n");
    const formatted = formatConfigRange(input, { startLine: 1, endLine: 1 }, formatOptions);
    expect(formatted).toBe("    maxconn         1000");
  });

  it("indents directives inside a range without collapsing spacing", () => {
    const input = "frontend web\n    bind             :80\n    mode             http";
    const formatted = formatConfigRange(input, { startLine: 1, endLine: 2 }, formatOptions);
    expect(formatted).toBe("    bind             :80\n    mode             http");
  });

  it("returns empty string for inverted ranges", () => {
    const input = "frontend web\n    bind :80";
    expect(formatConfigRange(input, { startLine: 1, endLine: 0 }, formatOptions)).toBe("");
  });

  it("reconstructs token spacing from source offsets", () => {
    const code = "mode             http";
    const tokens = tokenizeLine(code);
    expect(preserveTokenSpacing(code, tokens)).toBe("mode             http");
    expect(preserveTokenSpacing("mode http", [])).toBe("");
    expect(preserveTokenSpacing("mode  http", tokenizeLine("mode  http"))).toBe("mode  http");
  });
});
