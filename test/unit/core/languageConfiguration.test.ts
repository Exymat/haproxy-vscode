import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadSchema } from "../../helpers/schema";

const repoRoot = join(__dirname, "../../..");
const configuration = JSON.parse(
  readFileSync(join(repoRoot, "language-configuration.json"), "utf-8"),
) as {
  indentationRules: { increaseIndentPattern: string; decreaseIndentPattern: string };
  onEnterRules: Array<{ action: { indent: string } }>;
};

describe("language configuration indentation", () => {
  it("indents after every supported section header without nesting directives", () => {
    const increase = new RegExp(configuration.indentationRules.increaseIndentPattern);
    const decrease = new RegExp(configuration.indentationRules.decreaseIndentPattern);
    const headers = new Set<string>();
    for (const version of ["2.6", "2.8", "3.0", "3.2", "3.4"] as const) {
      for (const header of loadSchema(version).line_layout?.section_headers ?? []) {
        headers.add(header);
      }
    }
    for (const header of headers) {
      expect(increase.test(`${header} example`)).toBe(true);
      expect(decrease.test(`${header} example`)).toBe(true);
    }
    expect(increase.test("    mode http")).toBe(false);
    expect(configuration.onEnterRules.some((rule) => rule.action.indent === "indentOutdent")).toBe(
      false,
    );
  });
});
