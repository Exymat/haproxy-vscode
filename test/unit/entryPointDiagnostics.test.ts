import { describe, expect, it } from "vitest";

import {
  buildSectionBlocks,
  entryPointWithoutBindDiagnostics,
  sectionHasBind,
} from "../../src/entryPointDiagnostics";
import { type ParsedLine } from "../../src/parser";
import { parseDocument } from "../helpers/parse";
import { bindDetectKeywordSet, entryPointSectionSet } from "../../src/schema/symbols";
import { createDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";

const schema = loadSchema("3.4");
const bindTokens = bindDetectKeywordSet(schema);
const entryCtx = {
  entryPointSections: entryPointSectionSet(schema),
  bindDetectKeywords: bindTokens,
  schema,
};
const defaultsSection = "defaults";

describe("entryPointDiagnostics", () => {
  it("returns no diagnostics when there are no section blocks", () => {
    const document = createDocument("# only comments");
    const parsed = parseDocument(document);
    expect(entryPointWithoutBindDiagnostics(document, parsed, entryCtx)).toEqual([]);
  });

  it("skips malformed section headers when building blocks", () => {
    const crafted: ParsedLine[] = [
      {
        line: 0,
        section: "frontend",
        tokens: [],
        isSectionHeader: true,
        anonymousDefaults: false,
      },
      {
        line: 1,
        section: "frontend",
        tokens: [{ text: "bind", start: 4, end: 8 }],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
    ];
    expect(buildSectionBlocks(crafted, schema)).toEqual([]);
    expect(
      entryPointWithoutBindDiagnostics(createDocument("frontend web"), crafted, entryCtx),
    ).toEqual([]);
  });

  it("treats bind-process as a bind directive", () => {
    const document = createDocument("frontend web\n    bind-process 1");
    const parsed = parseDocument(document);
    expect(entryPointWithoutBindDiagnostics(document, parsed, entryCtx)).toEqual([]);
  });

  it("inherits bind from previous unnamed defaults", () => {
    const document = createDocument("defaults\n    bind :80\nfrontend web\n    mode http");
    const parsed = parseDocument(document);
    expect(entryPointWithoutBindDiagnostics(document, parsed, entryCtx)).toEqual([]);
  });

  it("reuses memoized bind lookups", () => {
    const document = createDocument("defaults\n    bind :80\nfrontend web\n    mode http");
    const parsed = parseDocument(document);
    const blocks = buildSectionBlocks(parsed, schema);
    const feIdx = blocks.findIndex((block) => block.kind === "frontend");
    const memo = new Map<number, boolean>();
    const resolving = new Set<number>();

    expect(
      sectionHasBind(parsed, blocks, feIdx, memo, resolving, bindTokens, defaultsSection),
    ).toBe(true);
    expect(
      sectionHasBind(parsed, blocks, feIdx, memo, resolving, bindTokens, defaultsSection),
    ).toBe(true);
  });

  it("stops resolving circular defaults inheritance", () => {
    const document = createDocument(
      "defaults a from b\ndefaults b from a\nfrontend web from a\n    mode http",
    );
    const parsed = parseDocument(document);
    const blocks = buildSectionBlocks(parsed, schema);
    const feIdx = blocks.findIndex((block) => block.kind === "frontend");
    const memo = new Map<number, boolean>();
    const resolving = new Set<number>();

    expect(
      sectionHasBind(parsed, blocks, feIdx, memo, resolving, bindTokens, defaultsSection),
    ).toBe(false);
    const diags = entryPointWithoutBindDiagnostics(document, parsed, entryCtx);
    expect(diags.some((diag) => diag.code === "no-bind-entry-point")).toBe(true);
  });

  it("handles sparse parsed arrays when scanning for bind tokens", () => {
    const blocks = buildSectionBlocks(
      [
        {
          line: 0,
          section: "frontend",
          tokens: [
            { text: "frontend", start: 0, end: 8 },
            { text: "web", start: 9, end: 12 },
          ],
          isSectionHeader: true,
          anonymousDefaults: false,
        },
      ],
      schema,
    );
    blocks[0].endLine = 2;
    const parsed = [
      {
        line: 0,
        section: "frontend",
        tokens: [{ text: "frontend", start: 0, end: 8 }],
        isSectionHeader: true,
        anonymousDefaults: false,
      },
      undefined,
      undefined,
    ] as unknown as ParsedLine[];
    const memo = new Map<number, boolean>();
    const resolving = new Set<number>();

    expect(sectionHasBind(parsed, blocks, 0, memo, resolving, bindTokens, defaultsSection)).toBe(
      false,
    );
  });

  it("returns false when bind resolution is already in progress", () => {
    const blocks = [
      {
        kind: "frontend",
        name: "web",
        fromDefaults: null,
        headerLine: 0,
        startLine: 0,
        endLine: 0,
      },
    ];
    const parsed: ParsedLine[] = [
      {
        line: 0,
        section: "frontend",
        tokens: [],
        isSectionHeader: true,
        anonymousDefaults: false,
      },
    ];
    const memo = new Map<number, boolean>();
    const resolving = new Set<number>([0]);

    expect(sectionHasBind(parsed, blocks, 0, memo, resolving, bindTokens, defaultsSection)).toBe(
      false,
    );
  });

  it("returns false when defaults inheritance cycles", () => {
    const blocks = [
      {
        kind: "defaults",
        name: "a",
        fromDefaults: "b",
        headerLine: 0,
        startLine: 0,
        endLine: 1,
      },
      {
        kind: "defaults",
        name: "b",
        fromDefaults: "a",
        headerLine: 1,
        startLine: 1,
        endLine: 1,
      },
      {
        kind: "frontend",
        name: "web",
        fromDefaults: "a",
        headerLine: 2,
        startLine: 2,
        endLine: 2,
      },
    ];
    const parsed = blocks.map((block) => ({
      line: block.startLine,
      section: block.kind,
      tokens: [{ text: block.kind, start: 0, end: block.kind.length }],
      isSectionHeader: true,
      anonymousDefaults: false,
    }));
    const memo = new Map<number, boolean>();
    const resolving = new Set<number>();

    expect(sectionHasBind(parsed, blocks, 2, memo, resolving, bindTokens, defaultsSection)).toBe(
      false,
    );
  });

  it("reuses cached entry-point diagnostics at the same document version", () => {
    const document = createDocument("frontend web\n    mode http");
    const parsed = parseDocument(document);
    const first = entryPointWithoutBindDiagnostics(document, parsed, entryCtx);
    const second = entryPointWithoutBindDiagnostics(document, parsed, entryCtx);
    expect(second).toBe(first);
    expect(first.some((diag) => diag.code === "no-bind-entry-point")).toBe(true);
  });
});
