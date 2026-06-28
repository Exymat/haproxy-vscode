import { describe, expect, it } from "vitest";

import {
  extractLogFormatRegions,
  logFormatFlagAtOffset,
  logFormatCompletionPrefix,
  logFormatFlagSpans,
  logformatAliasNames,
  logformatFlagNames,
  validateLogFormatItems,
  validateLogFormatLine,
} from "../../src/logFormat";
import { logFormatDiagnostics } from "../../src/logFormatDiagnostics";
import { parseDocument, tokenizeLine } from "../../src/parser";
import type { HaproxySchema } from "../../src/schema";
import { createDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";

const schemaStub: HaproxySchema = {
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

describe("logFormat branches", () => {
  it("covers fallback slots and duplicate region handling", () => {
    const schema = { ...schemaStub, logformat_slots: [] };
    expect(
      extractLogFormatRegions(
        'error-log-format "%ci"',
        tokenizeLine('error-log-format "%ci"'),
        schema,
      ),
    ).toEqual([expect.objectContaining({ text: '"%ci"' })]);
    const dupSchema: HaproxySchema = {
      ...schemaStub,
      logformat_slots: [
        { kind: "line_tail", directive: "log-format", skip: 0 },
        { kind: "line_tail", directive: "log-format", skip: 0 },
      ],
    };
    expect(
      extractLogFormatRegions('log-format "%ci"', tokenizeLine('log-format "%ci"'), dupSchema),
    ).toHaveLength(1);
  });

  it("covers malformed slot entries and parenthesized directives", () => {
    const malformed: HaproxySchema = {
      ...schemaStub,
      logformat_slots: [
        { kind: "line_tail", skip: 0 },
        { kind: "prefix", skip: 0 },
        { kind: "line_tail", directive: "log-format", skip: 0 },
      ],
    };
    expect(
      extractLogFormatRegions('log-format "%ci"', tokenizeLine('log-format "%ci"'), malformed),
    ).toHaveLength(1);
    const paren: HaproxySchema = {
      ...schemaStub,
      logformat_slots: [{ kind: "line_tail", directive: "log-format", skip: 0 }],
    };
    expect(
      extractLogFormatRegions(
        "log-format(something) %ci",
        tokenizeLine("log-format(something) %ci"),
        paren,
      ),
    ).toEqual([expect.objectContaining({ text: "%ci" })]);
  });

  it("covers prefix regions and stop-token behavior", () => {
    const schema: HaproxySchema = {
      ...schemaStub,
      logformat_slots: [
        { kind: "prefix", prefix: "set-var-fmt", skip: 0 },
        { kind: "prefix", prefix: "uri-lf", skip: 0 },
      ],
    };
    expect(
      extractLogFormatRegions(
        "set-var-fmt(txn.id) %ci",
        tokenizeLine("set-var-fmt(txn.id) %ci"),
        schema,
      ),
    ).toEqual([expect.objectContaining({ text: "%ci" })]);
    expect(
      extractLogFormatRegions(
        "http-check send on-success if",
        tokenizeLine("http-check send on-success if"),
        schemaStub,
      ),
    ).toEqual([expect.objectContaining({ text: "if" })]);
  });

  it("covers absent catalogs, cached validation, and prefix tails", () => {
    const schema: HaproxySchema = { ...schemaStub, logformat_aliases: undefined, tokens: {} };
    expect(logformatAliasNames(schema)).toEqual(new Set());
    expect(logformatFlagNames(schema)).toEqual(new Set());
    expect(
      validateLogFormatItems("%ci %{+Q}o", 0, schema).some(
        (issue) => issue.code === "logformat-unknown-alias",
      ),
    ).toBe(true);
    const line = 'log-format "%zz"';
    const tokens = tokenizeLine(line);
    const regions = extractLogFormatRegions(line, tokens, schemaStub);
    expect(
      validateLogFormatLine(line, tokens, schemaStub, regions).some(
        (issue) => issue.code === "logformat-unknown-alias",
      ),
    ).toBe(true);
    expect(logFormatCompletionPrefix("%(name){+Q}o", 12)).toBe("Q}o");
  });

  it("covers diagnostics, flags, and prefix-duplication branches", () => {
    const doc = createDocument('defaults\n    log-format "%zz"');
    const diagnostics = logFormatDiagnostics(
      parseDocument(doc)[1],
      doc.lineAt(1).text,
      loadSchema("3.4"),
    );
    expect(diagnostics[0]?.code).toBe("logformat-unknown-alias");
    expect(logFormatFlagSpans("%{?Q}o")).toEqual([]);
    const prefixDupSchema: HaproxySchema = {
      ...schemaStub,
      logformat_slots: [
        { kind: "prefix", prefix: "uri-lf", skip: 0 },
        { kind: "prefix", prefix: "uri-lf", skip: 0 },
      ],
    };
    expect(
      extractLogFormatRegions(
        "http-check send uri-lf %ci",
        tokenizeLine("http-check send uri-lf %ci"),
        prefixDupSchema,
      ),
    ).toHaveLength(1);
  });

  it("covers single-stop regions and completion-prefix null branches", () => {
    expect(extractLogFormatRegions("log-format", tokenizeLine("log-format"), schemaStub)).toEqual(
      [],
    );
    expect(
      extractLogFormatRegions("log-format if", tokenizeLine("log-format if"), schemaStub),
    ).toEqual([expect.objectContaining({ text: "if" })]);
    expect(logFormatFlagAtOffset("%{+Q}o", 3)?.flag).toBe("Q");
    expect(logFormatFlagSpans("%{+Q")).toEqual([]);
    expect(logFormatCompletionPrefix("%%ci", 4)).toBeNull();
    expect(logFormatCompletionPrefix("%[src]", 5)).toBeNull();
  });

  it("reuses cached log-format slots for the same schema object", () => {
    const schema = { ...schemaStub };
    expect(
      extractLogFormatRegions('log-format "%ci"', tokenizeLine('log-format "%ci"'), schema),
    ).toHaveLength(1);
    expect(
      extractLogFormatRegions('log-format "%ci"', tokenizeLine('log-format "%ci"'), schema),
    ).toHaveLength(1);
  });

  it("sorts multiple detected log-format regions", () => {
    const schema: HaproxySchema = {
      ...schemaStub,
      logformat_slots: [
        { kind: "prefix", prefix: "uri-lf", skip: 0 },
        { kind: "prefix", prefix: "hdr", skip: 1 },
      ],
    };
    const regions = extractLogFormatRegions(
      "http-check send hdr Host %ci uri-lf %cp",
      tokenizeLine("http-check send hdr Host %ci uri-lf %cp"),
      schema,
    );
    expect(regions).toHaveLength(2);
    expect(regions[0].start).toBeLessThan(regions[1].start);
  });
});
