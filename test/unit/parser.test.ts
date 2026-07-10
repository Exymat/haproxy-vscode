import { commentStartIndex, parseDocument, tokenizeLine } from "../../src/parser";
import { isInsideQuotedString } from "../../src/expressionParsing";
import { createDocument } from "../helpers/document";
import { parseOptionsWithSchema } from "../helpers/formatOptions";

interface CommentBoundaryCase {
  name: string;
  line: string;
  tokens: ReturnType<typeof tokenizeLine>;
  commentStart: number;
}

describe("isInsideQuotedString", () => {
  it("detects positions inside double- and single-quoted spans", () => {
    expect(isInsideQuotedString('reg "a(b)"', 6)).toBe(true);
    expect(isInsideQuotedString("reg 'a(b)'", 6)).toBe(true);
    expect(isInsideQuotedString('reg "a(b)"', 3)).toBe(false);
  });
});

describe("tokenizeLine", () => {
  it("handles escaped characters inside double quotes", () => {
    expect(tokenizeLine('set-header X "a\\"b"')).toEqual([
      { text: "set-header", start: 0, end: 10 },
      { text: "X", start: 11, end: 12 },
      { text: '"a\\"b"', start: 13, end: 19 },
    ]);
  });

  it("stops at inline comment when not inside a token", () => {
    expect(tokenizeLine("mode http # trailing")).toEqual([
      { text: "mode", start: 0, end: 4 },
      { text: "http", start: 5, end: 9 },
    ]);
  });

  const commentBoundaryCases: CommentBoundaryCase[] = [
    {
      name: "keeps unquoted hash inside token",
      line: "set-var(txn.x) a#b",
      tokens: [
        { text: "set-var(txn.x)", start: 0, end: 14 },
        { text: "a#b", start: 15, end: 18 },
      ],
      commentStart: -1,
    },
    {
      name: "keeps hash joined to section-like token",
      line: "global#comment",
      tokens: [{ text: "global#comment", start: 0, end: 14 }],
      commentStart: -1,
    },
    {
      name: "keeps quoted hash inside token and finds trailing comment",
      line: 'set-var(txn.x) "a#b" # trailing',
      tokens: [
        { text: "set-var(txn.x)", start: 0, end: 14 },
        { text: '"a#b"', start: 15, end: 20 },
      ],
      commentStart: 21,
    },
    {
      name: "finds whitespace-started comment",
      line: "mode http   # or tcp",
      tokens: [
        { text: "mode", start: 0, end: 4 },
        { text: "http", start: 5, end: 9 },
      ],
      commentStart: 12,
    },
    {
      name: "finds leading-whitespace comment-only line",
      line: "    # comment only",
      tokens: [],
      commentStart: 4,
    },
  ];

  for (const testCase of commentBoundaryCases) {
    it(`matches comment boundary semantics: ${testCase.name}`, () => {
      expect(commentStartIndex(testCase.line)).toBe(testCase.commentStart);
      expect(tokenizeLine(testCase.line)).toEqual(testCase.tokens);
    });
  }

  it("parses anonymous defaults section header", () => {
    const doc = createDocument("defaults\n    maxconn 100");
    const parsed = parseDocument(doc, parseOptionsWithSchema("3.2"));
    expect(parsed[0].anonymousDefaults).toBe(true);
    expect(parsed[1].anonymousDefaults).toBe(true);
  });

  it("parses named defaults without anonymous flag", () => {
    const doc = createDocument("defaults my-profile\n    maxconn 100");
    const parsed = parseDocument(doc, parseOptionsWithSchema("3.2"));
    expect(parsed[0].anonymousDefaults).toBe(false);
  });

  it("uses provided section headers", () => {
    const doc = createDocument("custom-section my-block\n    mode http");
    const parsed = parseDocument(doc, { sectionHeaders: new Set(["custom-section"]) });
    expect(parsed[0].isSectionHeader).toBe(true);
    expect(parsed[0].section).toBe("custom-section");
  });

  it("uses default section headers when options are omitted", () => {
    const doc = createDocument("frontend web\n    mode http");
    const parsed = parseDocument(doc, parseOptionsWithSchema("3.2"));
    expect(parsed[0].isSectionHeader).toBe(true);
  });

  it("tokenizes single-quoted values at line start", () => {
    expect(tokenizeLine("'mode' http")).toEqual([
      { text: "'mode'", start: 0, end: 6 },
      { text: "http", start: 7, end: 11 },
    ]);
  });
});
