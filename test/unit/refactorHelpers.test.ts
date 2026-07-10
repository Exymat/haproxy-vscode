import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { invalidateAllExtensionCaches } from "../../src/cacheInvalidation";
import { isOptionLine, optionNameTokenIndex } from "../../src/optionLine";
import { parseDocument } from "../helpers/parse";
import {
  findReferencePatternAtToken,
  findReferencePatternMatches,
} from "../../src/referencePatternMatching";
import { loadLanguageData, clearLanguageDataCache } from "../../src/languageData";
import { ReferencePattern } from "../../src/schema/types";
import { clearSchemaCache, loadSchema } from "../../src/schema/load";
import { sectionHeaderSet } from "../../src/schema/layout";
import { createDocument } from "../helpers/document";
import { loadSchema as loadFixtureSchema } from "../helpers/schema";

describe("refactor helpers", () => {
  beforeEach(() => {
    invalidateAllExtensionCaches();
  });

  it("detects option lines and option token index", () => {
    const optionParsed = parseDocument(createDocument("defaults\n    option httplog"));
    const bindParsed = parseDocument(createDocument("frontend web\n    bind :80"));
    const optionLine = optionParsed.find((line) => line.tokens[0]?.text === "option");
    const bindLine = bindParsed.find((line) => line.tokens[0]?.text === "bind");
    expect(optionLine).toBeDefined();
    expect(bindLine).toBeDefined();
    if (!optionLine || !bindLine) {
      return;
    }
    expect(isOptionLine(optionLine)).toBe(true);
    expect(optionNameTokenIndex(optionLine)).toBe(1);
    expect(isOptionLine(bindLine)).toBe(false);
    expect(optionNameTokenIndex(bindLine)).toBe(-1);
  });

  it("matches reference patterns", () => {
    const tokens = [
      { text: "use-backend", start: 0, end: 11 },
      { text: "web", start: 12, end: 15 },
    ];
    const pattern: ReferencePattern = {
      match_tokens: ["use-backend"],
      reference_kind: "backend",
      target_token_index: 1,
      scope: "global",
    };
    expect(findReferencePatternMatches(tokens, pattern)).toEqual([
      {
        start: 0,
        targetIndex: 1,
        targetToken: tokens[1],
      },
    ]);
    expect(findReferencePatternAtToken(tokens, pattern, 1)?.targetToken.text).toBe("web");
    expect(findReferencePatternAtToken(tokens, pattern, 0)).toBeNull();
    expect(findReferencePatternAtToken(tokens, pattern, 99)).toBeNull();
    expect(
      findReferencePatternMatches(
        [
          { text: "use-backend", start: 0, end: 11 },
          { text: "web", start: 12, end: 15 },
          { text: "use-backend", start: 16, end: 27 },
        ],
        { ...pattern, match_tokens: ["use-backend"], target_token_index: 2 },
      ),
    ).toEqual([
      {
        start: 0,
        targetIndex: 2,
        targetToken: { text: "use-backend", start: 16, end: 27 },
      },
    ]);
  });

  it("derives section headers from schema for parsing", () => {
    const schema = loadFixtureSchema("3.4");
    const headers = sectionHeaderSet(schema);
    expect(headers.has("frontend")).toBe(true);
    const parsed = parseDocument(createDocument("frontend web\n    mode http"), "3.4");
    expect(parsed[0].isSectionHeader).toBe(true);
  });

  it("rejects invalid schema and language data contracts", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "haproxy-contract-"));
    const schemasDir = join(tempRoot, "schemas");
    mkdirSync(schemasDir, { recursive: true });
    const context = { extensionPath: tempRoot } as never;

    writeFileSync(
      join(schemasDir, "haproxy-3.4.schema.json"),
      JSON.stringify({ version: "3.4", sections: {} }),
      "utf-8",
    );
    clearSchemaCache();
    expect(() => loadSchema(context, "3.4")).toThrow(/missing keywords/);

    writeFileSync(
      join(schemasDir, "haproxy-3.4.schema.json"),
      JSON.stringify({ version: "", sections: {}, keywords: {}, tokens: {} }),
      "utf-8",
    );
    clearSchemaCache();
    expect(() => loadSchema(context, "3.4")).toThrow(/missing a version string/);

    writeFileSync(
      join(schemasDir, "haproxy-3.4.schema.json"),
      JSON.stringify({ version: "3.4", keywords: {}, tokens: {} }),
      "utf-8",
    );
    clearSchemaCache();
    expect(() => loadSchema(context, "3.4")).toThrow(/missing sections/);

    writeFileSync(
      join(schemasDir, "haproxy-3.4.schema.json"),
      JSON.stringify({ version: "3.4", sections: {}, keywords: {} }),
      "utf-8",
    );
    clearSchemaCache();
    expect(() => loadSchema(context, "3.4")).toThrow(/missing address_policies/);

    writeFileSync(
      join(schemasDir, "haproxy-3.4.schema.json"),
      JSON.stringify({
        version: "3.4",
        sections: {},
        keywords: {},
        tokens: {},
        statement_rules: "invalid",
      }),
      "utf-8",
    );
    clearSchemaCache();
    expect(() => loadSchema(context, "3.4")).toThrow(/missing statement_rules/);

    writeFileSync(
      join(schemasDir, "haproxy-3.4.language.json"),
      JSON.stringify({ docsBaseUrl: "", keywords: {}, groups: {} }),
      "utf-8",
    );
    clearLanguageDataCache();
    expect(() => loadLanguageData(context, "3.4")).toThrow(/missing a version string/);

    writeFileSync(
      join(schemasDir, "haproxy-3.4.language.json"),
      JSON.stringify({ version: "3.4", docsBaseUrl: "", groups: {} }),
      "utf-8",
    );
    clearLanguageDataCache();
    expect(() => loadLanguageData(context, "3.4")).toThrow(/missing keywords/);

    writeFileSync(
      join(schemasDir, "haproxy-3.4.language.json"),
      JSON.stringify({ version: "3.4", docsBaseUrl: "", keywords: {} }),
      "utf-8",
    );
    clearLanguageDataCache();
    expect(() => loadLanguageData(context, "3.4")).toThrow(/missing groups/);

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
