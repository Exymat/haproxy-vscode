import { provideCompletionItems } from "../../src/completion";
import { tryDirectiveArgumentCompletion } from "../../src/completion/handlers/directiveArgument";
import { logFormatCompletionItems } from "../../src/completion/helpers";
import * as documentContext from "../../src/documentContext";
import * as directiveUtils from "../../src/directiveUtils";
import * as languageDataIndexes from "../../src/languageDataIndexes";
import * as lineSemanticContext from "../../src/lineSemanticContext";
import { LanguageGroupItem } from "../../src/languageData";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");

function mockOptionsGroupItems(items: LanguageGroupItem[]): void {
  const byName = new Map(items.map((item) => [item.name, item]));
  const origIndexedGroupItems = languageDataIndexes.indexedGroupItems;
  const origIndexedGroupItemsByName = languageDataIndexes.indexedGroupItemsByName;
  vi.spyOn(languageDataIndexes, "indexedGroupItems").mockImplementation((data, group) => {
    if (group === "options") {
      return items;
    }
    return origIndexedGroupItems(data, group);
  });
  vi.spyOn(languageDataIndexes, "indexedGroupItemsByName").mockImplementation((data, group) => {
    if (group === "options") {
      return byName;
    }
    return origIndexedGroupItemsByName(data, group);
  });
}

function completionLabels(content: string, lineNo: number, character: number) {
  const doc = createDocument(content);
  const items = provideCompletionItems(
    doc,
    { line: lineNo, character } as never,
    bundle.languageData,
    bundle.schema,
  );
  return items.map((item) => item.label).sort();
}

describe("completion extended", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suggests section headers at file start", () => {
    const labels = completionLabels("", 0, 0);
    expect(labels).toEqual(expect.arrayContaining(["global", "defaults", "frontend", "backend"]));
  });

  it("suggests option names", () => {
    const content = "defaults\n    no option ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels).toEqual(expect.arrayContaining(["httplog", "forwardfor"]));
  });

  it("suggests services after http-request use-service", () => {
    const origGroupItems = documentContext.groupItems;
    vi.spyOn(documentContext, "groupItems").mockImplementation((data, group) => {
      if (group === "services") {
        return [{ name: "ping", description: "ping service", signature: "ping", rulesets: [] }];
      }
      return origGroupItems(data, group);
    });
    const content = "frontend web\n    http-request use-service ";
    const line = content.split("\n")[1];
    const labels = completionLabels(content, 1, line.length);
    expect(labels).toContain("ping");
  });

  it("suggests tcp-request actions", () => {
    const content = "frontend web\n    tcp-request connection ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).not.toContain("acl");
  });

  it("suggests filter names", () => {
    const content = "backend api\n    filter ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("suggests sample fetches in expressions", () => {
    const content = "frontend web\n    http-request set-header X %[req.";
    const line = content.split("\n")[1];
    const labels = completionLabels(content, 1, line.length);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("suggests sample converters after colon in expression", () => {
    const content = "frontend web\n    http-request set-header X %[path(0):";
    const line = content.split("\n")[1];
    const labels = completionLabels(content, 1, line.length);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("suggests acl criteria", () => {
    const content = "frontend web\n    acl test ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels).toEqual(expect.arrayContaining(["path", "hdr"]));
  });

  it("returns empty for directive-argument without matched directive", () => {
    const content = "defaults\n    notadirective ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels).toEqual([]);
  });

  it("returns empty for directive-argument when line semantic context is unavailable", () => {
    const doc = createDocument("defaults\n    mode ");
    vi.spyOn(lineSemanticContext, "getLineSemanticContext").mockReturnValue(null);
    const items = tryDirectiveArgumentCompletion({
      document: doc,
      position: { line: 1, character: 9 } as never,
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: {
        kind: "directive-argument",
        tokenIndex: 1,
        prefix: "",
        line: {
          line: 1,
          text: "    mode ",
          indent: 4,
          section: "defaults",
          tokens: [{ text: "mode", start: 4, end: 8 }],
        },
      } as never,
      partial: "",
    });
    expect(items).toEqual([]);
  });

  it("suggests section directive keywords", () => {
    const content = "frontend web\n    bi";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels).toEqual(expect.arrayContaining(["bind"]));
  });

  it("returns empty on section header lines", () => {
    const labels = completionLabels("global", 0, 1);
    expect(labels).toEqual([]);
  });

  it("suggests http-request actions", () => {
    const content = "frontend web\n    http-request set";
    const line = content.split("\n")[1];
    const col = line.indexOf("set");
    const labels = completionLabels(content, 1, col);
    expect(labels).toEqual(expect.arrayContaining(["set-header", "add-header"]));
  });

  it("suggests http-response actions", () => {
    const content = "frontend web\n    http-response set";
    const line = content.split("\n")[1];
    const col = line.indexOf("set");
    const labels = completionLabels(content, 1, col);
    expect(labels).toEqual(expect.arrayContaining(["set-header", "add-header"]));
  });

  it("suggests http-after-response actions", () => {
    const content = "frontend web\n    http-after-response set";
    const line = content.split("\n")[1];
    const col = line.indexOf("set");
    const labels = completionLabels(content, 1, col);
    expect(labels).toEqual(expect.arrayContaining(["set-header", "add-header"]));
  });

  it("suggests tcp-response actions", () => {
    const content = "frontend web\n    tcp-response content ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).not.toContain("acl");
  });

  it("suggests filter names at the filter token", () => {
    const content = "backend api\n    filter";
    const col = "    filter".indexOf("filter");
    const labels = completionLabels(content, 1, col);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("does not fall back to section directive suggestions when token index is not zero", () => {
    const content = "frontend web\n    bind :80 extra";
    const col = content.split("\n")[1].indexOf("extra");
    const labels = completionLabels(content, 1, col);
    expect(labels).not.toContain("bind");
    expect(labels).not.toContain("acl");
  });

  it("returns empty completion on bind address tokens before options", () => {
    const line = "    bind 192.168.1.22:80, :81, 192.168.1.23:82 ";
    const col = line.indexOf(":81") + 1;
    const labels = completionLabels(`frontend web\n${line}`, 1, col);
    expect(labels).toEqual([]);
  });

  it("suggests server line-option argument values after the option name", () => {
    const content = "backend api\n    server s1 127.0.0.1:80 cookie app01 ins";
    const line = content.split("\n")[1];
    const labels = completionLabels(content, 1, line.length);
    expect(labels).toEqual(expect.arrayContaining(["insert"]));
    expect(labels).not.toContain("ssl");
  });

  it("returns empty for directive kind with a non-zero token index", () => {
    const doc = createDocument("defaults\n    mode http junk");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      kind: "directive",
      tokenIndex: 2,
      line: {
        line: 1,
        text: "    mode http junk",
        indent: 4,
        section: "defaults",
        tokens: [
          { text: "mode", start: 4, end: 8 },
          { text: "http", start: 9, end: 13 },
          { text: "junk", start: 14, end: 18 },
        ],
      },
    } as never);
    vi.spyOn(documentContext, "keywordsForSection").mockReturnValue([
      {
        name: "mode",
        signatures: ["mode <mode>"],
        description: "",
        docsUrl: undefined,
        arguments: [],
      },
      {
        name: "balance",
        signatures: ["balance <algorithm>"],
        description: "",
        docsUrl: undefined,
        arguments: [],
      },
    ] as never);

    const items = provideCompletionItems(
      doc,
      { line: 1, character: 14 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(items).toEqual([]);
  });

  it("handles directive argument completion when schema keyword is missing", () => {
    const doc = createDocument("defaults\n    mode ");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      kind: "directive-argument",
      tokenIndex: 2,
      line: {
        line: 1,
        text: "    mode ",
        indent: 4,
        section: "defaults",
        tokens: [
          { text: "mode", start: 4, end: 8 },
          { text: "http", start: 9, end: 13 },
        ],
      },
    } as never);
    vi.spyOn(documentContext, "keywordsForSection").mockReturnValue([]);
    vi.spyOn(directiveUtils, "resolveDirective").mockReturnValue({
      matched: true,
      start: 0,
      end: 0,
      keyword: "madeup-directive",
    });
    vi.spyOn(directiveUtils, "getKeywordFromSchema").mockReturnValue(undefined);
    vi.spyOn(directiveUtils, "argumentPosition").mockReturnValue(0);
    vi.spyOn(directiveUtils, "completionValuesForPosition").mockReturnValue([
      { name: "alpha", description: "alpha value" },
    ]);

    const items = provideCompletionItems(
      doc,
      { line: 1, character: 9 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(items).toHaveLength(1);
    expect(items[0].detail).toBe("argument");
  });

  it("builds keyword docs when description and signatures are empty", () => {
    const doc = createDocument("frontend web\n    ");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      kind: "directive",
      tokenIndex: 0,
      line: {
        line: 1,
        text: "    ",
        indent: 4,
        section: "frontend",
        tokens: [],
      },
    } as never);
    vi.spyOn(documentContext, "keywordsForSection").mockReturnValue([
      {
        name: "fake-keyword",
        signatures: [],
        description: "",
        docsUrl: undefined,
        arguments: [],
      },
    ] as never);

    const items = provideCompletionItems(
      doc,
      { line: 1, character: 4 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(items).toHaveLength(1);
    expect(items[0].detail).toBe("fake-keyword");
  });

  it("builds option documentation from fallback no-option keyword", () => {
    const doc = createDocument("defaults\n    option legacy");
    const data = structuredClone(bundle.languageData);
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      kind: "option",
      tokenIndex: 1,
      line: {
        line: 1,
        text: "    option legacy",
        indent: 4,
        section: "defaults",
        tokens: [
          { text: "option", start: 4, end: 10 },
          { text: "legacy", start: 11, end: 17 },
        ],
      },
    } as never);
    mockOptionsGroupItems([
      { name: "legacy", description: "Legacy option", signature: "legacy", rulesets: [] },
    ]);
    data.keywords["option legacy"] = undefined as never;
    data.keywords["no option legacy"] = {
      name: "no option legacy",
      signatures: ["no option legacy"],
      sections: ["defaults"],
      description: "Disable legacy mode",
      docsUrl: "https://example.test/legacy",
      arguments: [],
    };

    const items = provideCompletionItems(
      doc,
      { line: 1, character: 17 } as never,
      data,
      bundle.schema,
    );
    expect(items).toHaveLength(1);
    expect(items[0].documentation).toBeDefined();
  });

  it("supports expression-converter completion group", () => {
    const content = "frontend web\n    http-request set-header X %[path:";
    const doc = createDocument(content);
    const originalGroupItems = documentContext.groupItems;
    const data = structuredClone(bundle.languageData);
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      kind: "expression-converter",
      tokenIndex: 0,
      line: {
        line: 1,
        text: "    http-request set-header X %[path:lower",
        indent: 4,
        section: "frontend",
        tokens: [],
      },
    } as never);
    vi.spyOn(documentContext, "groupItems").mockImplementation((data, group) => {
      if (group === "sample_converters") {
        return [{ name: "lower", description: "to lower", rulesets: [] }] as never;
      }
      return originalGroupItems(data, group);
    });
    const items = provideCompletionItems(
      doc,
      { line: 1, character: content.split("\n")[1].length } as never,
      data,
      bundle.schema,
    );
    expect(items.map((i) => i.label)).toContain("lower");
  });

  it("uses option group description/docs when language keyword docs are missing", () => {
    const doc = createDocument("defaults\n    option grouped");
    const data = structuredClone(bundle.languageData);
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      kind: "option",
      tokenIndex: 1,
      line: {
        line: 1,
        text: "    option grouped",
        indent: 4,
        section: "defaults",
        tokens: [
          { text: "option", start: 4, end: 10 },
          { text: "grouped", start: 11, end: 18 },
        ],
      },
    } as never);
    mockOptionsGroupItems([
      {
        name: "grouped",
        description: "Group-only description",
        signature: "grouped",
        docsUrl: "https://example.test/grouped",
        rulesets: [],
      },
    ]);
    data.keywords["option grouped"] = {
      name: "option grouped",
      signatures: ["option grouped"],
      sections: ["defaults"],
      description: "",
      docsUrl: undefined,
      arguments: [],
    } as never;
    const items = provideCompletionItems(
      doc,
      { line: 1, character: 18 } as never,
      data,
      bundle.schema,
    );
    expect(items).toHaveLength(1);
    expect(items[0].documentation).toBeDefined();
  });

  it("uses option keyword description/docs when available", () => {
    const doc = createDocument("defaults\n    option directdoc");
    const data = structuredClone(bundle.languageData);
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      kind: "option",
      tokenIndex: 1,
      line: {
        line: 1,
        text: "    option directdoc",
        indent: 4,
        section: "defaults",
        tokens: [
          { text: "option", start: 4, end: 10 },
          { text: "directdoc", start: 11, end: 20 },
        ],
      },
    } as never);
    mockOptionsGroupItems([
      { name: "directdoc", description: "", signature: "directdoc", rulesets: [] },
    ]);
    data.keywords["option directdoc"] = {
      name: "option directdoc",
      signatures: ["option directdoc"],
      sections: ["defaults"],
      description: "Keyword description",
      docsUrl: "https://example.test/directdoc",
      arguments: [],
    };
    const items = provideCompletionItems(
      doc,
      { line: 1, character: 20 } as never,
      data,
      bundle.schema,
    );
    expect(items).toHaveLength(1);
    expect(items[0].documentation).toBeDefined();
  });

  it("suggests log-format aliases inside format strings", () => {
    const content = 'defaults\n    log-format "%c';
    const line = content.split("\n")[1];
    const labels = completionLabels(content, 1, line.length);
    expect(labels).toContain("ci");
    expect(labels).not.toContain("zz");
  });

  it("suggests log-format flags inside brace blocks", () => {
    const content = 'defaults\n    log-format "%{+';
    const line = content.split("\n")[1];
    const labels = completionLabels(content, 1, line.length);
    expect(labels).toEqual(expect.arrayContaining(["Q", "E", "X"]));
  });

  it("includes documentation for log-format alias completions", () => {
    const doc = createDocument('defaults\n    log-format "%ci');
    const line = doc.lineAt(1).text;
    const items = provideCompletionItems(
      doc,
      { line: 1, character: line.length } as never,
      bundle.languageData,
      bundle.schema,
    );
    const ci = items.find((item) => item.label === "ci");
    expect(ci?.detail).toBe("%ci");
    expect(ci?.documentation).toBeDefined();
  });
});

describe("logFormatCompletionItems", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to an empty prefix when no %-token precedes the offset", () => {
    const text = "plain text";
    const items = logFormatCompletionItems(bundle.languageData, bundle.schema, text, text.length);
    const aliasCount = documentContext.groupItems(bundle.languageData, "logformat_aliases").length;
    expect(items).toHaveLength(aliasCount);
  });

  it("returns no flags when the schema has no logformat_flags token", () => {
    const schema = structuredClone(bundle.schema);
    delete schema.tokens.logformat_flags;
    const items = logFormatCompletionItems(bundle.languageData, schema, "%{+", 3);
    expect(items).toEqual([]);
  });

  it("omits documentation for flags without a matching language group entry", () => {
    const schema = structuredClone(bundle.schema);
    schema.tokens.logformat_flags = ["UNKNOWNFLAGXYZ"];
    const items = logFormatCompletionItems(bundle.languageData, schema, "%{+", 3);
    expect(items).toHaveLength(1);
    expect(items[0].detail).toBe("log-format flag");
    expect(items[0].documentation).toBeUndefined();
  });

  it("omits documentation for aliases without a description", () => {
    vi.spyOn(documentContext, "groupItems").mockReturnValue([
      { name: "%nodesc", description: "", rulesets: [] },
    ] as never);
    const items = logFormatCompletionItems(bundle.languageData, bundle.schema, "%", 1);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("nodesc");
    expect(items[0].documentation).toBeUndefined();
  });
});
