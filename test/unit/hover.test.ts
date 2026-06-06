import * as directiveUtils from "../../src/directiveUtils";
import { provideHover } from "../../src/hover";
import * as documentContext from "../../src/documentContext";
import * as languageData from "../../src/languageData";
import { MarkdownString } from "../__mocks__/vscode";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const bundles = {
  "3.2": loadSchemaBundle("3.2"),
  "3.4": loadSchemaBundle("3.4"),
};
type TestVersion = keyof typeof bundles;

function hoverText(hover: NonNullable<ReturnType<typeof provideHover>>): string {
  const md = Array.isArray(hover.contents) ? hover.contents[0] : hover.contents;
  if (md instanceof MarkdownString) {
    return md.value;
  }
  return typeof md === "string" ? md : ((md as { value?: string })?.value ?? "");
}

function hoverMarkdown(content: string, lineNo: number, character: number, version: TestVersion) {
  const doc = createDocument(content);
  const bundle = bundles[version];
  const hover = provideHover(
    doc,
    { line: lineNo, character } as never,
    bundle.languageData,
    bundle.schema,
  );
  if (!hover) {
    return "";
  }
  return hoverText(hover);
}

describe("provideHover", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("returns null when context is missing", () => {
    const doc = createDocument("");
    const hover = provideHover(
      doc,
      { line: 0, character: 0 } as never,
      bundles["3.4"].languageData,
      bundles["3.4"].schema,
    );
    expect(hover).toBeNull();
  });

  it("documents option keywords", () => {
    const text = hoverMarkdown("defaults\n    option httplog", 1, 11, "3.4");
    expect(text).toContain("option");
    expect(text.length).toBeGreaterThan(0);
  });

  it("documents bind line options from section 5.1", () => {
    const text = hoverMarkdown(
      "frontend web\n    bind :443 ssl",
      1,
      "    bind :443 ssl".indexOf("ssl"),
      "3.4",
    );
    expect(text.toLowerCase()).toContain("ssl");
    expect(text).not.toMatch(/\bbind\b.*\bbind\b/s);
  });

  it("documents server line options from section 5.2", () => {
    const text = hoverMarkdown(
      "backend api\n    server s1 127.0.0.1:80 check",
      1,
      "    server s1 127.0.0.1:80 check".indexOf("check"),
      "3.4",
    );
    expect(text.toLowerCase()).toContain("check");
    expect(text.toLowerCase()).not.toContain("**server**");
    expect(text).toContain("Valid in modes:");
  });

  it("shows mode-context metadata for keyword hovers", () => {
    const text = hoverMarkdown(
      "frontend web\n    capture cookie SID len 64",
      1,
      "    capture cookie SID len 64".indexOf("cookie"),
      "3.4",
    );
    expect(text).toContain("Valid in modes:");
    expect(text.toLowerCase()).toContain("http");
  });

  it("documents http-request actions", () => {
    const text = hoverMarkdown(
      "frontend web\n    http-request deny",
      1,
      "    http-request deny".indexOf("deny"),
      "3.4",
    );
    expect(text.toLowerCase()).toContain("deny");
  });

  it("documents conditional directives at line start", () => {
    const doc = createDocument("global\n    .if { always_true }");
    const bundle = bundles["3.4"];
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "global",
        tokens: [{ text: ".if", start: 4, end: 7 }],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    .if { always_true }",
      tokenIndex: 0,
      token: { text: ".if", start: 4, end: 7 },
      kind: "directive",
      prefix: "    .if",
    });
    const hover = provideHover(
      doc,
      { line: 1, character: 5 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(hover).not.toBeNull();
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text.toLowerCase()).toContain(".if");
  });

  it("documents acl criteria", () => {
    const text = hoverMarkdown(
      "frontend web\n    acl test path -m beg /",
      1,
      "    acl test path".indexOf("path"),
      "3.4",
    );
    expect(text.toLowerCase()).toContain("path");
  });

  it("documents acl flags", () => {
    const text = hoverMarkdown(
      "frontend web\n    acl test path -m beg /",
      1,
      "    acl test path -m".indexOf("-m"),
      "3.4",
    );
    expect(text.length).toBeGreaterThan(0);
  });

  it("documents directive keywords", () => {
    const text = hoverMarkdown("defaults\n    mode", 1, 7, "3.4");
    expect(text.toLowerCase()).toContain("mode");
  });

  it("documents argument enum values", () => {
    const text = hoverMarkdown(
      "defaults\n    mode http",
      1,
      "    mode http".indexOf("http"),
      "3.4",
    );
    expect(text.toLowerCase()).toContain("http");
  });

  it("falls back to group item documentation", () => {
    const text = hoverMarkdown(
      "defaults\n    balance roundrobin",
      1,
      "    balance roundrobin".indexOf("roundrobin"),
      "3.4",
    );
    expect(text.toLowerCase()).toContain("roundrobin");
  });

  it("returns null for unknown tokens without documentation", () => {
    const text = hoverMarkdown("defaults\n    totallyunknownkeyword", 1, 8, "3.4");
    expect(text).toBe("");
  });

  it("version-specific mode hover differs between 3.2 and 3.4", () => {
    const text34 = hoverMarkdown("defaults\n    mode", 1, 7, "3.4");
    const text32 = hoverMarkdown("defaults\n    mode", 1, 7, "3.2");
    expect(text34).toContain("haterm");
    expect(text32).not.toContain("haterm");
  });

  it("documents multi-signature directives", () => {
    const text = hoverMarkdown("frontend web\n    bind", 1, "    bind".indexOf("bind"), "3.4");
    expect(text).toContain("Forms");
    expect(text).toContain("bind");
  });

  it("documents argument parameter descriptions", () => {
    const doc = createDocument("defaults\n    backlog 128");
    const bundle = bundles["3.4"];
    const data = structuredClone(bundle.languageData);
    data.keywords.backlog = {
      ...data.keywords.backlog,
      arguments: [
        {
          description: "Maximum number of pending connections.",
          parameter: "<conns>",
          values: [],
        },
      ],
    };
    const col = "    backlog 128".indexOf("128");
    const hover = provideHover(doc, { line: 1, character: col } as never, data, bundle.schema);
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text).toContain("Parameter:");
    expect(text).toContain("Maximum number of pending connections.");
  });

  it("uses prefix matching for multi-word directives", () => {
    const text = hoverMarkdown(
      "defaults\n    balance url_param sid",
      1,
      "    balance url_param sid".indexOf("url_param"),
      "3.4",
    );
    expect(text.toLowerCase()).toContain("url_param");
  });

  it("documents option values on no option lines", () => {
    const doc = createDocument("defaults\n    no option httplog");
    const bundle = bundles["3.4"];
    const httplogStart = "    no option httplog".indexOf("httplog");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "defaults",
        tokens: [
          { text: "no", start: 4, end: 6 },
          { text: "option", start: 7, end: 13 },
          { text: "httplog", start: httplogStart, end: httplogStart + 7 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    no option httplog",
      tokenIndex: 2,
      token: { text: "httplog", start: httplogStart, end: httplogStart + 7 },
      kind: "option",
      prefix: "    no option httplog",
    });
    const hover = provideHover(
      doc,
      { line: 1, character: httplogStart + 2 } as never,
      bundle.languageData,
      bundle.schema,
    );
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text).toContain("option httplog");
  });

  it("documents group items via findGroupItem fallback", () => {
    const doc = createDocument("frontend web\n    acl test path -m beg /");
    const bundle = bundles["3.4"];
    const begCol = "    acl test path -m beg".indexOf("beg");
    const hover = provideHover(
      doc,
      { line: 1, character: begCol + 1 } as never,
      bundle.languageData,
      bundle.schema,
    );
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text.toLowerCase()).toContain("beg");
  });

  it("documents group items via generic fallback path", () => {
    const doc = createDocument("frontend web\n    acl test base /");
    const bundle = bundles["3.4"];
    const baseCol = "    acl test base".indexOf("base");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "frontend",
        tokens: [
          { text: "acl", start: 4, end: 7 },
          { text: "test", start: 8, end: 12 },
          { text: "base", start: baseCol, end: baseCol + 4 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    acl test base /",
      tokenIndex: 2,
      token: { text: "base", start: baseCol, end: baseCol + 4 },
      kind: "directive",
      prefix: "    acl test base",
    });
    vi.spyOn(languageData, "findKeywordByPrefix").mockReturnValue(undefined);
    vi.spyOn(directiveUtils, "resolveDirective").mockReturnValue({
      matched: false,
      keyword: "",
      start: 0,
      end: 0,
    });
    const hover = provideHover(
      doc,
      { line: 1, character: baseCol + 1 } as never,
      bundle.languageData,
      bundle.schema,
    );
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text.toLowerCase()).toContain("base");
  });

  it("documents group items when keyword lookup fails", () => {
    const doc = createDocument("frontend web\n    acl test path -m beg /");
    const bundle = bundles["3.4"];
    const begCol = "    acl test path -m beg".indexOf("beg");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "frontend",
        tokens: [
          { text: "acl", start: 4, end: 7 },
          { text: "test", start: 8, end: 12 },
          { text: "path", start: 13, end: 17 },
          { text: "-m", start: 18, end: 20 },
          { text: "beg", start: begCol, end: begCol + 3 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    acl test path -m beg /",
      tokenIndex: 4,
      token: { text: "beg", start: begCol, end: begCol + 3 },
      kind: "acl-criterion",
      prefix: "    acl test path -m beg",
    });
    vi.spyOn(languageData, "findKeywordByPrefix").mockReturnValue(undefined);
    const hover = provideHover(
      doc,
      { line: 1, character: begCol + 1 } as never,
      bundle.languageData,
      bundle.schema,
    );
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text.toLowerCase()).toContain("beg");
  });
});
