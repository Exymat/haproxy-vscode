import { describe, expect, it } from "vitest";

import {
  extractLogFormatItems,
  extractLogFormatRegions,
  logFormatCompletionPrefix,
  logFormatContextAt,
  logFormatItemAtOffset,
  logFormatFlagAtOffset,
  logFormatRegionAtOffset,
  validateLogFormatItems,
  validateLogFormatLine,
} from "../../src/logFormat";
import { tokenizeLine } from "../../src/parser";
import type { HaproxySchema } from "../../src/schema";
import { loadSchema } from "../helpers/schema";

const schemaStub: HaproxySchema = {
  ...loadSchema("3.4"),
  version: "3.4",
  sections: {},
  keywords: {},
  keyword_groups: {},
  statement_rules: [],
  sample_fetches: {},
  sample_converters: {},
  logformat_aliases: {
    "%ci": {
      name: "%ci",
      field_name: "client_ip",
      sample_fetch: "%[src]",
      type: "IP",
      restrictions: "",
      category: "",
    },
    "%o": {
      name: "%o",
      field_name: "apply flags globally",
      sample_fetch: "",
      type: "",
      restrictions: "",
      category: "",
    },
  },
  logformat_slots: [
    { kind: "line_tail", directive: "log-format", skip: 0 },
    { kind: "line_tail", directive: "set-var-fmt", skip: 1 },
    { kind: "prefix", prefix: "uri-lf", skip: 0 },
    { kind: "prefix", prefix: "hdr", skip: 1 },
    { kind: "prefix", prefix: "on-success", skip: 0 },
  ],
  tokens: { logformat_flags: ["Q", "E", "X"] },
};

describe("logFormat core", () => {
  it("parses items, regions, and prefixes", () => {
    expect(extractLogFormatItems("%{+Q}o %ci %[src] %%literal")).toEqual([
      expect.objectContaining({ kind: "alias", alias: "%o", flags: ["Q"] }),
      expect.objectContaining({ kind: "alias", alias: "%ci" }),
      expect.objectContaining({ kind: "expression" }),
    ]);
    expect(
      logFormatRegionAtOffset(
        '  log-format "%{+Q}o %ci"',
        tokenizeLine('  log-format "%{+Q}o %ci"'),
        '  log-format "%{+Q}o %ci"'.indexOf("%"),
        schemaStub,
      ),
    ).toEqual(expect.objectContaining({ text: '"%{+Q}o %ci"', start: 13 }));
    expect(logFormatCompletionPrefix("%{+Q,E", 7)).toBe("E");
  });

  it("covers embedded regions and validation", () => {
    expect(
      extractLogFormatRegions(
        "http-check send uri-lf %ci ver HTTP/1.1",
        tokenizeLine("http-check send uri-lf %ci ver HTTP/1.1"),
        schemaStub,
      ),
    ).toEqual([expect.objectContaining({ text: "%ci" })]);
    expect(
      extractLogFormatRegions(
        'set-var-fmt txn.id "%ci"',
        tokenizeLine('set-var-fmt txn.id "%ci"'),
        schemaStub,
      ),
    ).toEqual([expect.objectContaining({ text: '"%ci"' })]);
    expect(
      validateLogFormatItems("%zz %{+Z}o", 0, schemaStub).some(
        (issue) => issue.code === "logformat-unknown-alias",
      ),
    ).toBe(true);
    expect(
      validateLogFormatLine(
        "http-check send uri-lf %zz",
        tokenizeLine("http-check send uri-lf %zz"),
        schemaStub,
      ).some((issue) => issue.code === "logformat-unknown-alias"),
    ).toBe(true);
  });

  it("covers context and offset helpers", () => {
    const line = 'log-format "%{+Q}o"';
    const tokens = tokenizeLine(line);
    const offset = line.lastIndexOf("o");
    const ctx = logFormatContextAt(line, tokens, offset, schemaStub);
    expect(ctx?.localOffset).toBe(offset - (ctx?.region.start ?? 0));
    expect(logFormatItemAtOffset("%{+Q}o %ci", 3)).toEqual(
      expect.objectContaining({ kind: "alias", alias: "%o", flags: ["Q"] }),
    );
    expect(logFormatFlagAtOffset('"%{+Q}o"', '"%{+Q}o"'.indexOf("Q"))).toEqual(
      expect.objectContaining({ flag: "Q", sign: "+" }),
    );
  });

  it("covers malformed and partial item parsing", () => {
    expect(extractLogFormatItems("%(name)%[src] %{+Q,-E}")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "named", named: "name" }),
        expect.objectContaining({ kind: "expression" }),
        expect.objectContaining({ kind: "flags", flags: ["Q", "E"] }),
      ]),
    );
    expect(extractLogFormatItems("%{Q}o")).toEqual([
      expect.objectContaining({ kind: "alias", alias: "%o" }),
    ]);
    expect(extractLogFormatItems("%{+Q+E}o")).toEqual([
      expect.objectContaining({ kind: "alias", alias: "%o", flags: ["Q", "E"] }),
    ]);
    expect(extractLogFormatItems("%(unclosed")).toEqual([
      expect.objectContaining({ kind: "named", named: "unclosed" }),
    ]);
    expect(extractLogFormatItems("%{+Q")).toEqual([]);
    expect(extractLogFormatItems("%[expr")).toEqual([
      expect.objectContaining({ kind: "expression" }),
    ]);
  });
});
