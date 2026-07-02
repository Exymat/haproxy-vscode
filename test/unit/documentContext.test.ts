import {
  getDocumentContext,
  getSectionKeywords,
  groupItems,
  keywordsForSection,
  sectionKeywordNames,
} from "../../src/documentContext";
import * as parseCache from "../../src/parseCache";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const { schema, languageData } = loadSchemaBundle("3.4");

function ctx(content: string, lineNo: number, character: number) {
  const doc = createDocument(content);
  return getDocumentContext(doc, { line: lineNo, character } as never, schema);
}

describe("documentContext", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when parsed line is missing", () => {
    const doc = createDocument("global");
    vi.spyOn(parseCache, "getParsedDocument").mockReturnValue([]);
    expect(getDocumentContext(doc, { line: 0, character: 0 } as never, schema)).toBeNull();
  });

  it("returns null on section name tokens and conditional directives", () => {
    expect(ctx("global", 0, 0)?.kind).toBe("section");
    expect(ctx("defaults\n    mode http", 0, 0)?.kind).toBe("section");
    expect(ctx("frontend web", 0, "frontend web".indexOf("web"))).toBeNull();
    expect(ctx("global\n    .if { always_true }", 1, 5)).toBeNull();
  });

  it("classifies top-level empty lines as section completion", () => {
    const hit = ctx("global\n    daemon\n\n    mode http", 2, 0);
    expect(hit?.kind).toBe("section");
    expect(hit?.tokenIndex).toBe(0);
    expect(hit?.token).toBeNull();
  });

  it("classifies indented blank lines as directive completion", () => {
    const lineText = "    ";
    const hit = ctx(`global\n    daemon\n${lineText}\n    mode http`, 2, lineText.length);
    expect(hit?.kind).toBe("directive");
  });

  it("classifies partial section header typing as section completion", () => {
    expect(ctx("fron", 0, 4)?.kind).toBe("section");
    expect(ctx("back", 0, 4)?.kind).toBe("section");
  });

  it("classifies expression fetch and converter contexts", () => {
    const fetchLine = "frontend web\n    http-request set-header X %[req.";
    const fetchCol = fetchLine.split("\n")[1].length;
    expect(ctx(fetchLine, 1, fetchCol)?.kind).toBe("expression-fetch");

    const convLine = "frontend web\n    http-request set-header X %[path(0):lower";
    const convCol = convLine.split("\n")[1].length;
    expect(ctx(convLine, 1, convCol)?.kind).toBe("expression-converter");
  });

  it("classifies statement rule kinds", () => {
    function colAt(content: string, lineNo: number, token: string) {
      const lineText = content.split("\n")[lineNo];
      return lineText.indexOf(token) + 1;
    }

    const cases: Array<{ content: string; line: number; token: string; kind: string }> = [
      { content: "defaults\n    no option httplog", line: 1, token: "httplog", kind: "option" },
      {
        content: "frontend web\n    http-request deny",
        line: 1,
        token: "deny",
        kind: "http-request",
      },
      {
        content: "frontend web\n    http-response set-header X v",
        line: 1,
        token: "set-header",
        kind: "http-response",
      },
      {
        content: "frontend web\n    http-after-response set-header X v",
        line: 1,
        token: "set-header",
        kind: "http-after-response",
      },
      {
        content: "frontend web\n    tcp-request connection accept",
        line: 1,
        token: "accept",
        kind: "tcp-request",
      },
      {
        content: "frontend web\n    tcp-response content reject",
        line: 1,
        token: "reject",
        kind: "tcp-response",
      },
      { content: "frontend web\n    acl test path", line: 1, token: "path", kind: "acl-criterion" },
      {
        content: "backend api\n    filter compression",
        line: 1,
        token: "compression",
        kind: "filter",
      },
      { content: "defaults\n    mode http", line: 1, token: "http", kind: "directive-argument" },
    ];
    for (const { content, line, token, kind } of cases) {
      expect(ctx(content, line, colAt(content, line, token))?.kind).toBe(kind);
    }
  });

  it("classifies directive and directive-argument by token index", () => {
    expect(ctx("defaults\n    mode", 1, 7)?.kind).toBe("directive");
    expect(ctx("defaults\n    mode ", 1, "    mode ".length)?.kind).toBe("directive-argument");
  });

  it("resolves token index in trailing whitespace after a token", () => {
    const lineText = "    mode  ";
    const content = `defaults\n${lineText}`;
    const hit = ctx(content, 1, lineText.length - 1);
    expect(hit?.tokenIndex).toBe(1);
    expect(hit?.token).toBeNull();
  });

  it("resolves token index in gaps between tokens", () => {
    const lineText = "    mode    http";
    const gapCol = lineText.indexOf("http") - 1;
    const hit = ctx(`defaults\n${lineText}`, 1, gapCol);
    expect(hit?.tokenIndex).toBe(1);
    expect(hit?.token).toBeNull();
  });

  it("resolves token index before first token content", () => {
    const lineText = "    mode http";
    const hit = ctx(`defaults\n${lineText}`, 1, 2);
    expect(hit?.tokenIndex).toBe(1);
    expect(hit?.token?.text).toBe("http");
  });

  it("ignores multi-word statement rule prefixes", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "special",
        kind: "directive",
        prefix: "no option",
        value_token_index: 2,
      },
    ];
    const doc = createDocument("defaults\n    no option special");
    const hit = getDocumentContext(doc, { line: 1, character: 20 } as never, customSchema);
    expect(hit?.kind).toBe("directive-argument");
  });

  it("classifies rules that use each token-index fallback", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      { keyword: "min-rule", kind: "bind", minimum_token_index: 2 },
      { keyword: "value-rule", kind: "directive", value_token_index: 1 },
      { keyword: "action-rule", kind: "http-request", action_token_index: 1 },
      { keyword: "nested-rule", kind: "server", nested_start_index: 1 },
      { keyword: "phase-rule", kind: "tcp-request", phase_token_index: 1 },
      { keyword: "plain-rule", kind: "filter" },
    ];

    expect(
      getDocumentContext(
        createDocument("defaults\n    min-rule x y"),
        { line: 1, character: "    min-rule x y".length } as never,
        customSchema,
      )?.kind,
    ).toBe("bind");
    expect(
      getDocumentContext(
        createDocument("defaults\n    value-rule x"),
        { line: 1, character: "    value-rule x".length } as never,
        customSchema,
      )?.kind,
    ).toBe("directive-argument");
    expect(
      getDocumentContext(
        createDocument("frontend web\n    action-rule deny"),
        { line: 1, character: "    action-rule deny".length } as never,
        customSchema,
      )?.kind,
    ).toBe("http-request");
    expect(
      getDocumentContext(
        createDocument("backend api\n    nested-rule x"),
        { line: 1, character: "    nested-rule x".length } as never,
        customSchema,
      )?.kind,
    ).toBe("server");
    expect(
      getDocumentContext(
        createDocument("frontend web\n    phase-rule content"),
        { line: 1, character: "    phase-rule content".length } as never,
        customSchema,
      )?.kind,
    ).toBe("tcp-request");
    expect(
      getDocumentContext(
        createDocument("backend api\n    plain-rule x"),
        { line: 1, character: "    plain-rule x".length } as never,
        customSchema,
      )?.kind,
    ).toBe("filter");
  });

  it("falls back to directive classification when statement rules are absent", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [];
    const hit = getDocumentContext(
      createDocument("defaults\n    custom"),
      { line: 1, character: "    custom".length } as never,
      customSchema,
    );
    expect(hit?.kind).toBe("directive");
  });

  it("returns directive kind for comment lines", () => {
    expect(ctx("defaults\n    # comment", 1, 6)?.kind).toBe("directive");
  });

  it("keywordsForSection and sectionKeywordNames filter by section", () => {
    const globalKeywords = keywordsForSection(languageData, "global");
    expect(globalKeywords.every((kw) => kw.sections.includes("global"))).toBe(true);
    expect(sectionKeywordNames(languageData, "global")).toEqual(
      globalKeywords.map((kw) => kw.name),
    );
    expect(keywordsForSection(languageData, null)).toEqual([]);
  });

  it("groupItems returns group entries or empty array", () => {
    const options = groupItems(languageData, "options");
    expect(options.length).toBeGreaterThan(0);
    expect(groupItems(languageData, "not_a_group")).toEqual([]);
  });

  it("getSectionKeywords lists section headers", () => {
    const names = getSectionKeywords(schema);
    expect(names).toEqual(expect.arrayContaining(["global", "defaults", "frontend", "backend"]));
  });
});
