import { describe, expect, it } from "vitest";

import {
  extractLogFormatArgument,
  extractLogFormatItems,
  extractLogFormatRegions,
  isLogFormatDirective,
  logFormatCompletionPrefix,
  logFormatContextAt,
  logFormatItemAtOffset,
  logFormatFlagAtOffset,
  logFormatRegionAtOffset,
  validateLogFormatItems,
  validateLogFormatLine,
} from "../../src/logFormat";
import { logFormatDiagnostics } from "../../src/logFormatDiagnostics";
import { parseDocument, tokenizeLine } from "../../src/parser";
import { HaproxySchema } from "../../src/schema";
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
  tokens: {
    logformat_flags: ["Q", "E", "X"],
  },
};

describe("extractLogFormatItems", () => {
  it("parses aliases, flags, and sample expressions", () => {
    const items = extractLogFormatItems("%{+Q}o %ci %[src] %%literal");
    expect(items).toEqual([
      expect.objectContaining({ kind: "alias", alias: "%o", flags: ["Q"] }),
      expect.objectContaining({ kind: "alias", alias: "%ci" }),
      expect.objectContaining({ kind: "expression" }),
    ]);
  });
});

describe("extractLogFormatArgument", () => {
  it("returns the format string offset after the directive", () => {
    const line = '  log-format "%{+Q}o %ci"';
    expect(extractLogFormatArgument(line)).toEqual({
      text: '"%{+Q}o %ci"',
      start: 13,
    });
  });

  it("returns null for unrelated lines", () => {
    expect(extractLogFormatArgument("frontend web")).toBeNull();
  });
});

describe("extractLogFormatRegions", () => {
  it("finds fmt regions on dedicated directives", () => {
    const line = 'log-format "%{+Q}o %ci"';
    const tokens = tokenizeLine(line);
    expect(extractLogFormatRegions(line, tokens, schemaStub)).toEqual([
      expect.objectContaining({ text: '"%{+Q}o %ci"' }),
    ]);
  });

  it("finds fmt regions after embedded prefixes", () => {
    const line = "http-check send uri-lf %ci ver HTTP/1.1";
    const tokens = tokenizeLine(line);
    const regions = extractLogFormatRegions(line, tokens, schemaStub);
    expect(regions).toEqual([expect.objectContaining({ text: "%ci" })]);
  });

  it("finds fmt regions after hdr name", () => {
    const line = 'http-check send hdr Host %ci comment "probe"';
    const tokens = tokenizeLine(line);
    const regions = extractLogFormatRegions(line, tokens, schemaStub);
    expect(regions).toEqual([expect.objectContaining({ text: "%ci" })]);
  });

  it("returns multiple embedded regions sorted by start offset", () => {
    const line = "http-check send hdr Host %ci uri-lf %o ver HTTP/1.1";
    const tokens = tokenizeLine(line);
    const regions = extractLogFormatRegions(line, tokens, schemaStub);
    expect(regions).toEqual([
      expect.objectContaining({ text: "%ci" }),
      expect.objectContaining({ text: "%o" }),
    ]);
  });

  it("finds fmt regions in set-var-fmt lines", () => {
    const line = 'set-var-fmt txn.id "%ci"';
    const tokens = tokenizeLine(line);
    const regions = extractLogFormatRegions(line, tokens, schemaStub);
    expect(regions).toEqual([expect.objectContaining({ text: '"%ci"' })]);
  });
});

describe("validateLogFormatItems", () => {
  it("reports unknown aliases and flags", () => {
    const issues = validateLogFormatItems("%zz %{+Z}o", 0, schemaStub);
    expect(issues.some((issue) => issue.code === "logformat-unknown-alias")).toBe(true);
    expect(issues.some((issue) => issue.code === "logformat-unknown-flag")).toBe(true);
  });

  it("accepts known aliases and flags", () => {
    const issues = validateLogFormatItems("%{+Q}o %ci", 0, schemaStub);
    expect(issues).toEqual([]);
  });
});

describe("validateLogFormatLine", () => {
  it("validates embedded fmt arguments", () => {
    const line = "http-check send uri-lf %zz";
    const tokens = tokenizeLine(line);
    const issues = validateLogFormatLine(line, tokens, schemaStub);
    expect(issues.some((issue) => issue.code === "logformat-unknown-alias")).toBe(true);
  });
});

describe("logFormatCompletionPrefix", () => {
  it("returns null when no percent sign or inside sample expressions", () => {
    expect(logFormatCompletionPrefix("hello", 5)).toBeNull();
    expect(logFormatCompletionPrefix("%%", 2)).toBeNull();
    expect(logFormatCompletionPrefix("%[src]", 3)).toBeNull();
  });

  it("returns active flag prefix inside brace blocks", () => {
    expect(logFormatCompletionPrefix("%{+", 3)).toBe("");
    expect(logFormatCompletionPrefix("%{+Q,", 6)).toBe("");
    expect(logFormatCompletionPrefix("%{+Q,E", 7)).toBe("E");
  });

  it("returns alias tail after named groups and braces", () => {
    expect(logFormatCompletionPrefix("%(foo)o", 8)).toBe("o");
    expect(logFormatCompletionPrefix("%ci", 3)).toBe("ci");
  });
});

describe("logFormatContextAt", () => {
  it("returns local offset inside format regions", () => {
    const line = 'log-format "%{+Q}o"';
    const tokens = tokenizeLine(line);
    const offset = line.lastIndexOf("o");
    const ctx = logFormatContextAt(line, tokens, offset, schemaStub);
    expect(ctx).toEqual(
      expect.objectContaining({
        localOffset: offset - (ctx?.region.start ?? 0),
      }),
    );
  });

  it("returns null outside format regions", () => {
    const line = 'log-format "%{+Q}o"';
    const tokens = tokenizeLine(line);
    expect(logFormatRegionAtOffset(line, tokens, 0, schemaStub)).toBeNull();
    expect(logFormatContextAt(line, tokens, 0, schemaStub)).toBeNull();
  });
});

describe("logFormatItemAtOffset", () => {
  it("returns the span covering the cursor offset", () => {
    const text = "%{+Q}o %ci";
    expect(logFormatItemAtOffset(text, 3)).toEqual(
      expect.objectContaining({ kind: "alias", alias: "%o", flags: ["Q"] }),
    );
    expect(logFormatItemAtOffset(text, 999)).toBeNull();
  });
});

describe("isLogFormatDirective", () => {
  it("recognizes supported directives", () => {
    expect(isLogFormatDirective("log-format")).toBe(true);
    expect(isLogFormatDirective("set-var-fmt")).toBe(true);
    expect(isLogFormatDirective("other")).toBe(false);
    expect(isLogFormatDirective(undefined)).toBe(false);
  });
});

describe("extractLogFormatItems edge cases", () => {
  it("parses named sample expressions and flags-only spans", () => {
    const items = extractLogFormatItems("%(name)%[src] %{+Q,-E}");
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "named", named: "name" }),
        expect.objectContaining({ kind: "expression" }),
        expect.objectContaining({ kind: "flags", flags: ["Q", "E"] }),
      ]),
    );
  });

  it("ignores malformed flag tokens", () => {
    const items = extractLogFormatItems("%{Q}o");
    expect(items).toEqual([expect.objectContaining({ kind: "alias", alias: "%o" })]);
  });

  it("parses consecutive flag modifiers without commas", () => {
    const items = extractLogFormatItems("%{+Q+E}o");
    expect(items).toEqual([
      expect.objectContaining({ kind: "alias", alias: "%o", flags: ["Q", "E"] }),
    ]);
  });
});

describe("logFormatFlagAtOffset", () => {
  it("returns the flag under the cursor inside brace blocks", () => {
    const text = '"%{+Q}o"';
    const qOffset = text.indexOf("Q");
    expect(logFormatFlagAtOffset(text, qOffset)).toEqual(
      expect.objectContaining({ flag: "Q", sign: "+" }),
    );
    expect(logFormatFlagAtOffset(text, text.indexOf("o"))).toBeNull();
  });
});

describe("extractLogFormatRegions edge cases", () => {
  it("uses fallback slots when schema defines none", () => {
    const schema = { ...schemaStub, logformat_slots: [] };
    const line = 'error-log-format "%ci"';
    const tokens = tokenizeLine(line);
    expect(extractLogFormatRegions(line, tokens, schema)).toEqual([
      expect.objectContaining({ text: '"%ci"' }),
    ]);
  });

  it("returns null tail regions when no format argument follows", () => {
    const line = "log-format";
    const tokens = tokenizeLine(line);
    expect(extractLogFormatRegions(line, tokens, schemaStub)).toEqual([]);
  });

  it("stops at immediate stop tokens after embedded prefixes", () => {
    const line = "http-check send uri-lf comment probe";
    const tokens = tokenizeLine(line);
    expect(extractLogFormatRegions(line, tokens, schemaStub)).toEqual([
      expect.objectContaining({ text: "comment" }),
    ]);
  });
});

describe("logFormatDiagnostics", () => {
  it("wraps validation issues as vscode diagnostics", () => {
    const schema = loadSchema("3.4");
    const doc = createDocument('defaults\n    log-format "%zz"');
    const parsed = parseDocument(doc);
    const diagnostics = logFormatDiagnostics(parsed[1], doc.lineAt(1).text, schema);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual(
      expect.objectContaining({
        source: "haproxy",
        code: "logformat-unknown-alias",
      }),
    );
    expect(diagnostics[0]?.message).toContain("%zz");
  });
});
