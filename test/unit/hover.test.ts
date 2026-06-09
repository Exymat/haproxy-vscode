import * as directiveUtils from "../../src/directiveUtils";
import { formatHoverText, provideHover } from "../../src/hover";
import { tryActionHover } from "../../src/hover/handlers/actionHover";
import { tryOptionHover } from "../../src/hover/handlers/optionHover";
import { resolveNestedLineOptionSpan } from "../../src/hover/lineOptions";
import { addSectionExtra } from "../../src/hover/markdown";
import type { DocumentContextWithToken, HoverContext } from "../../src/hover/types";
import * as documentContext from "../../src/documentContext";
import { getDocumentContext } from "../../src/documentContext";
import * as languageData from "../../src/languageData";
import { MarkdownString, Range } from "../__mocks__/vscode";
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

function optionHoverContext(
  tokenText: string,
  overrides: Partial<DocumentContextWithToken> = {},
): HoverContext {
  const start = 11;
  const end = start + tokenText.length;
  const ctx: DocumentContextWithToken = {
    line: {
      line: 1,
      section: "defaults",
      tokens: [
        { text: "option", start: 4, end: 10 },
        { text: tokenText, start, end },
      ],
      isSectionHeader: false,
      anonymousDefaults: false,
    },
    lineText: `    option ${tokenText}`,
    tokenIndex: 1,
    token: { text: tokenText, start, end },
    kind: "option",
    prefix: `    option ${tokenText}`,
    ...overrides,
  };
  return {
    document: createDocument(""),
    position: { line: ctx.line.line, character: ctx.token.start } as never,
    data: bundles["3.4"].languageData,
    schema: bundles["3.4"].schema,
    ctx,
    range: new Range(ctx.line.line, ctx.token.start, ctx.line.line, ctx.token.end) as never,
    cursorOffset: 0,
    tokenLower: ctx.token.text.toLowerCase(),
  };
}

function actionHoverContext(tokenLower: string, data = bundles["3.4"].languageData): HoverContext {
  return {
    document: createDocument(""),
    position: { line: 1, character: 0 } as never,
    data,
    schema: bundles["3.4"].schema,
    ctx: optionHoverContext(tokenLower).ctx,
    range: new Range(1, 0, 1, tokenLower.length) as never,
    cursorOffset: 0,
    tokenLower,
  };
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
    expect(text).toContain("Valid in sections:");
    expect(text).toContain("Valid in modes:");
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

  it("distinguishes section scope from mode scope on directive hovers", () => {
    const text = hoverMarkdown("defaults\n    balance roundrobin", 1, 6, "3.4");
    expect(text).toContain("Valid in sections:");
    expect(text).toContain("Valid in modes:");
    expect(text).not.toContain("**Valid in:**");
  });

  it("shows all documented forms for server line options", () => {
    const text = hoverMarkdown(
      "backend api\n    server s1 127.0.0.1:80 source 0.0.0.0",
      1,
      "    server s1 127.0.0.1:80 source 0.0.0.0".indexOf("source"),
      "3.4",
    );
    expect(text).toContain("**Forms:**");
    expect(text).toContain("```haproxy");
    expect(text).toContain("```\n\n**Valid in modes:**");
    expect(text).toContain("usesrc");
    expect(text).toContain("interface");
    expect(text).toContain('Additionally, the "source" statement on a server line allows');
    expect(text).toContain("Since Linux 4.2/libc 2.23");
  });

  it("preserves ascii tables in hover documentation", () => {
    const text = hoverMarkdown(
      "backend api\n    server s1 127.0.0.1:80 inter 2s",
      1,
      "    server s1 127.0.0.1:80 inter 2s".indexOf("inter"),
      "3.4",
    );
    expect(text).toContain("| Server state | Interval used |");
    expect(text).toContain("| --- | --- |");
    expect(text).toContain('UP 100% (non-transitional) | "inter"');
    expect(text).toContain('"downinter" if set,<br>"inter" otherwise.');
  });

  it("formats ascii tables as markdown tables", () => {
    const formatted = formatHoverText(
      [
        "Prefix paragraph.",
        "",
        "Server state                   |         Interval used",
        "    ----------------------------------------+----------------------------------",
        '     UP 100% (non-transitional)             | "inter"',
        "    ----------------------------------------+----------------------------------",
        "",
        "Suffix paragraph.",
      ].join("\n"),
    );
    expect(formatted).toContain("| Server state | Interval used |");
    expect(formatted).toContain("| --- | --- |");
    expect(formatted).toContain('| UP 100% (non-transitional) | "inter" |');
  });

  it("keeps blank-line paragraph splits in hover documentation", () => {
    const text = hoverMarkdown(
      "frontend web\n    bind :443 ssl alpn h2",
      1,
      "    bind :443 ssl alpn h2".indexOf("alpn"),
      "3.4",
    );
    expect(text).toContain(
      "For example it is possible to only accept HTTP/2 connections with this:",
    );
    expect(text).toContain("QUIC supports only h3 and hq-interop as ALPN.");
    expect(text).toContain("connections with this:\n\n\n\nbind :443 ssl crt pub.pem alpn h2");
    expect(text).toContain("disable HTTP/1.1\n\n\n\nQUIC supports only h3");
    expect(text).toContain("[HAProxy documentation](");
  });

  it("merges wrapped dconv table rows with line breaks", () => {
    const formatted = formatHoverText(
      [
        "Server state                   |         Interval used",
        "    ----------------------------------------+----------------------------------",
        '     UP 100% (non-transitional)             | "inter"',
        "    ----------------------------------------+----------------------------------",
        '     Transitionally UP (going down "fall"), | "fastinter" if set,',
        '     Transitionally DOWN (going up "rise"), | "inter" otherwise.',
        "     or yet unchecked.                      |",
        "    ----------------------------------------+----------------------------------",
      ].join("\n"),
    );
    expect(formatted).toContain(
      '| Transitionally UP (going down "fall"),<br>Transitionally DOWN (going up "rise"),<br>or yet unchecked. | "fastinter" if set,<br>"inter" otherwise. |',
    );
  });

  it("collapses multi-section ascii tables when dconv parsing fails", () => {
    const formatted = formatHoverText(
      ["Col A | Col B", "------+------", "x | y", "plain text between sections", "z | w"].join(
        "\n",
      ),
    );
    expect(formatted).toContain("| Col A | Col B |");
    expect(formatted).toContain("| x | y |");
    expect(formatted).toContain("| z | w |");
  });

  it("falls back to fenced text for invalid table blocks", () => {
    const block = ["only | one", "------+------"].join("\n");
    const formatted = formatHoverText(`intro\n\n${block}\n\noutro`);
    expect(formatted).toContain("```text");
    expect(formatted).toContain("only | one");
  });

  it("finishes dconv table rows without a trailing separator", () => {
    const formatted = formatHoverText(
      ["State | Value", "------+------", "UP | inter", "DOWN | fast"].join("\n"),
    );
    expect(formatted).toContain("| UP<br>DOWN | inter<br>fast |");
  });

  it("rejects dconv tables with a non-pipe header row", () => {
    const formatted = formatHoverText(
      [
        "plain header without pipe",
        "------+------",
        "a | b",
        "plain text between sections",
        "c | d",
      ].join("\n"),
    );
    expect(formatted).toContain("| a | b |");
    expect(formatted).toContain("| c | d |");
  });

  it("rejects dconv tables with mismatched separators", () => {
    const formatted = formatHoverText(
      ["A | B", "------+------", "x | y", "-------+-------", "z | w"].join("\n"),
    );
    expect(formatted).toContain("| x | y |");
    expect(formatted).toContain("| z | w |");
  });

  it("falls back to fenced text when table has insufficient columns", () => {
    const formatted = formatHoverText(["------+------", "------+------", "plain text"].join("\n"));
    expect(formatted).toContain("```text");
    expect(formatted).toContain("plain text");
  });

  it("keeps nested source sub-option hover on source instead of server", () => {
    const text = hoverMarkdown(
      "backend api\n    server s1 127.0.0.1:80 source 0.0.0.0 interface eth0",
      1,
      "    server s1 127.0.0.1:80 source 0.0.0.0 interface eth0".indexOf("interface"),
      "3.4",
    );
    expect(text).toContain("interface");
    expect(text).toContain("**interface**");
    expect(text).not.toContain("**source**");
    expect(text.toLowerCase()).not.toContain("**server**");
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

  it("documents parenthesized sample fetches in acl criteria", () => {
    const text = hoverMarkdown(
      "frontend web\n    acl test req.hdr(host) -m found",
      1,
      "    acl test req.hdr(host)".indexOf("req.hdr") + 2,
      "3.4",
    );
    expect(text.toLowerCase()).toContain("req.hdr");
    expect(text.toLowerCase()).not.toContain("**acl**");
  });

  it("prefers sample fetch docs over bare acl criterion entries", () => {
    const text = hoverMarkdown(
      "frontend web\n    acl test hdr_cnt(host) eq 1",
      1,
      "    acl test hdr_cnt(host)".indexOf("hdr_cnt") + 2,
      "3.4",
    );
    expect(text.toLowerCase()).toContain("hdr_cnt");
    expect(text.toLowerCase()).toContain("deprecated");
    expect(text.toLowerCase()).toContain("returns an integer value");
  });

  it("documents req.hdr_cnt with the upstream anchor", () => {
    const text = hoverMarkdown(
      "frontend web\n    acl test req.hdr_cnt(host) eq 1",
      1,
      "    acl test req.hdr_cnt(host)".indexOf("req.hdr_cnt") + 3,
      "3.4",
    );
    expect(text).toContain("req.hdr_cnt");
    expect(text).toContain("Returns an integer value");
    expect(text).toContain("https://docs.haproxy.org/3.4/configuration.html#req.hdr_cnt");
    expect(text).not.toContain("#7.3-req.hdr_cnt");
    expect(text).not.toContain("#7.3.6-req.hdr_cnt");
  });

  it("documents sample fetches inside expressions", () => {
    const text = hoverMarkdown(
      "frontend web\n    http-request set-header X-Test %[req.hdr(host)]",
      1,
      "    http-request set-header X-Test %[req.hdr(host)]".indexOf("req.hdr") + 2,
      "3.4",
    );
    expect(text.toLowerCase()).toContain("req.hdr");
    expect(text.toLowerCase()).toContain("returns");
  });

  it("ignores whitespace-only sample token candidates", () => {
    const doc = createDocument("frontend web\n    http-request set-header X-Test %[   ]");
    const bundle = bundles["3.4"];
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "frontend",
        tokens: [{ text: "   ", start: 40, end: 43 }],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    http-request set-header X-Test %[   ]",
      tokenIndex: 0,
      token: { text: "   ", start: 40, end: 43 },
      kind: "expression-fetch",
      prefix: "    http-request set-header X-Test %[   ]",
    });
    const hover = provideHover(
      doc,
      { line: 1, character: 41 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(hover).toBeNull();
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

  it("documents keyworded arguments extracted from Arguments blocks", () => {
    const text = hoverMarkdown(
      "backend api\n    http-check send meth GET",
      1,
      "    http-check send meth GET".indexOf("meth"),
      "3.4",
    );
    expect(text).toContain("meth");
    expect(text).toContain("OPTIONS");
    expect(text).toContain("**Directive:** http-check send");
  });

  it("shows argument alias forms on hover", () => {
    const text = hoverMarkdown(
      "backend api\n    balance random(5)",
      1,
      "    balance random(5)".indexOf("random"),
      "3.4",
    );
    expect(text).toContain("**Forms:**");
    expect(text).toContain("random");
    expect(text).toContain("random(<draws>)");
    expect(text).toContain("Power of Two Random Choices");
    expect(text).not.toContain("**Parameter:**");
    expect(text).toContain("**Directive:** balance");
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

  it("shows section-specific signatures instead of merged cross-chapter forms", () => {
    const text = hoverMarkdown("frontend web\n    bind", 1, "    bind".indexOf("bind"), "3.4");
    expect(text).toContain("bind");
    expect(text).not.toContain("Forms");
    expect(text).toContain("#4.2-bind");
  });

  it("documents argument parameter descriptions", () => {
    const doc = createDocument("defaults\n    backlog 128");
    const bundle = bundles["3.4"];
    const data = structuredClone(bundle.languageData);
    const mockArguments = [
      {
        description: "Maximum number of pending connections.",
        parameter: "<conns>",
        values: [],
      },
    ];
    data.keywords.backlog = {
      ...data.keywords.backlog,
      arguments: mockArguments,
      variants: data.keywords.backlog.variants?.map((variant) =>
        variant.sections.includes("defaults") ? { ...variant, arguments: mockArguments } : variant,
      ),
    };
    const col = "    backlog 128".indexOf("128");
    const hover = provideHover(doc, { line: 1, character: col } as never, data, bundle.schema);
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text).toContain("**Parameter:** `<conns>`");
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

  it("returns null when option token has no known docs", () => {
    const doc = createDocument("defaults\n    option mystery");
    const bundle = bundles["3.4"];
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "defaults",
        tokens: [
          { text: "option", start: 4, end: 10 },
          { text: "mystery", start: 11, end: 18 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    option mystery",
      tokenIndex: 1,
      token: { text: "mystery", start: 11, end: 18 },
      kind: "option",
      prefix: "    option mystery",
    });
    expect(
      provideHover(doc, { line: 1, character: 12 } as never, bundle.languageData, bundle.schema),
    ).toBeNull();
  });

  it("documents line options even without explicit signature", () => {
    const doc = createDocument("frontend web\n    bind :443 ssl");
    const bundle = bundles["3.4"];
    const data = structuredClone(bundle.languageData);
    data.groups.bind_options = [
      {
        name: "ssl",
        description: "Enable TLS.",
        docsUrl: undefined,
        rulesets: [],
      } as never,
    ];
    const sslCol = "    bind :443 ssl".indexOf("ssl");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "frontend",
        tokens: [
          { text: "bind", start: 4, end: 8 },
          { text: ":443", start: 9, end: 13 },
          { text: "ssl", start: sslCol, end: sslCol + 3 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    bind :443 ssl",
      tokenIndex: 2,
      token: { text: "ssl", start: sslCol, end: sslCol + 3 },
      kind: "bind",
      prefix: "    bind :443 ssl",
    });
    const hover = provideHover(
      doc,
      { line: 1, character: sslCol + 1 } as never,
      data,
      bundle.schema,
    );
    expect(hover).not.toBeNull();
    if (hover === null) {
      throw new Error("expected hover");
    }
    expect(hoverText(hover)).toContain("ssl");
  });

  it("returns null for unknown acl criterion token", () => {
    const doc = createDocument("frontend web\n    acl test unknown");
    const bundle = bundles["3.4"];
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "frontend",
        tokens: [
          { text: "acl", start: 4, end: 7 },
          { text: "test", start: 8, end: 12 },
          { text: "unknown", start: 13, end: 20 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    acl test unknown",
      tokenIndex: 2,
      token: { text: "unknown", start: 13, end: 20 },
      kind: "acl-criterion",
      prefix: "    acl test unknown",
    });
    vi.spyOn(languageData, "findKeywordByPrefix").mockReturnValue(undefined);
    vi.spyOn(directiveUtils, "resolveDirective").mockReturnValue({
      matched: false,
      keyword: "",
      start: 0,
      end: 0,
    });
    expect(
      provideHover(doc, { line: 1, character: 15 } as never, bundle.languageData, bundle.schema),
    ).toBeNull();
  });

  it("documents argument value without parameter/keyword extras", () => {
    const doc = createDocument("defaults\n    mode custom");
    const bundle = bundles["3.4"];
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "defaults",
        tokens: [
          { text: "mode", start: 4, end: 8 },
          { text: "custom", start: 9, end: 15 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    mode custom",
      tokenIndex: 1,
      token: { text: "custom", start: 9, end: 15 },
      kind: "directive-argument",
      prefix: "    mode custom",
    });
    vi.spyOn(directiveUtils, "resolveDirective").mockReturnValue({
      matched: true,
      keyword: "mode",
      start: 0,
      end: 0,
    });
    vi.spyOn(directiveUtils, "findArgumentValue").mockReturnValue({
      name: "custom",
      description: "HTTP mode",
      parameter: "",
    });
    vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockReturnValue(undefined);
    const hover = provideHover(
      doc,
      { line: 1, character: "    mode custom".indexOf("custom") + 1 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(hover).not.toBeNull();
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text).toContain("HTTP mode");
    expect(text).not.toContain("**Parameter:**");
    expect(text).not.toContain("**Directive:**");
  });

  it("falls back to directive name when keyword signatures are missing", () => {
    const doc = createDocument("defaults\n    mode");
    const bundle = bundles["3.4"];
    const data = structuredClone(bundle.languageData);
    data.keywords.mode = {
      ...data.keywords.mode,
      signatures: [],
      sections: [],
      description: "",
      arguments: [],
    };
    const hover = provideHover(doc, { line: 1, character: 7 } as never, data, bundle.schema);
    expect(hover).not.toBeNull();
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text.toLowerCase()).toContain("mode");
  });

  it("shows multiple signature forms on directive hover", () => {
    const doc = createDocument("defaults\n    multi-sig");
    const bundle = bundles["3.4"];
    const data = structuredClone(bundle.languageData);
    data.keywords["multi-sig"] = {
      name: "multi-sig",
      sections: ["defaults"],
      signatures: ["multi-sig <a>", "multi-sig <b>"],
      description: "Keyword with multiple forms.",
      docsUrl: "https://docs.haproxy.org/3.4/configuration.html#multi-sig",
    };
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "defaults",
        tokens: [{ text: "multi-sig", start: 4, end: 13 }],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    multi-sig",
      tokenIndex: 0,
      token: { text: "multi-sig", start: 4, end: 13 },
      kind: "directive",
      prefix: "    multi-sig",
    });
    vi.spyOn(directiveUtils, "resolveDirective").mockReturnValue({
      matched: true,
      keyword: "multi-sig",
      start: 0,
      end: 0,
    });
    const hover = provideHover(doc, { line: 1, character: 5 } as never, data, bundle.schema);
    expect(hover).not.toBeNull();
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text).toContain("**Forms:**");
    expect(text).toContain("```haproxy");
    expect(text).toContain("multi-sig <a>");
    expect(text).toContain("multi-sig <b>");
  });

  it("uses generic argument label when parameter name is empty", () => {
    const doc = createDocument("defaults\n    backlog 128");
    const bundle = bundles["3.4"];
    const data = structuredClone(bundle.languageData);
    const mockArguments = [
      {
        description: "Pending queue length.",
        parameter: "",
        values: [],
      },
    ];
    data.keywords.backlog = {
      ...data.keywords.backlog,
      arguments: mockArguments,
      variants: data.keywords.backlog.variants?.map((variant) =>
        variant.sections.includes("defaults") ? { ...variant, arguments: mockArguments } : variant,
      ),
    };
    const col = "    backlog 128".indexOf("128");
    const hover = provideHover(doc, { line: 1, character: col } as never, data, bundle.schema);
    expect(hover).not.toBeNull();
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text).toContain("**Parameter:** `argument`");
  });

  it("documents nested server option argument values", () => {
    const line = "    server s1 127.0.0.1:80 cookie app01 insert";
    const insertCol = line.indexOf("insert");
    const doc = createDocument(`backend api\n${line}`);
    const bundle = bundles["3.4"];
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "backend",
        tokens: [
          { text: "server", start: 4, end: 10 },
          { text: "s1", start: 11, end: 13 },
          { text: "127.0.0.1:80", start: 14, end: 26 },
          { text: "cookie", start: 27, end: 33 },
          { text: "app01", start: 34, end: 39 },
          { text: "insert", start: insertCol, end: insertCol + 6 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: line,
      tokenIndex: 5,
      token: { text: "insert", start: insertCol, end: insertCol + 6 },
      kind: "server",
      prefix: line.trimStart(),
    });
    vi.spyOn(directiveUtils, "findArgumentValue").mockReturnValue({
      name: "insert",
      description: "Insert persistence cookie mode.",
      parameter: "insert",
    });
    const hover = provideHover(
      doc,
      { line: 1, character: insertCol + 2 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(hover).not.toBeNull();
    if (hover === null) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text).not.toContain("**Parameter:**");
    expect(text).toContain("**Nested option:** cookie");
    expect(text).toContain("Insert persistence cookie mode.");
  });

  it("resolves nested server option spans past unrelated tokens", () => {
    const line = "    server s1 127.0.0.1:80 check junk ssl";
    const sslCol = line.indexOf("ssl");
    const text = hoverMarkdown(`backend api\n${line}`, 1, sslCol, "3.4");
    expect(text.toLowerCase()).toContain("ssl");

    const verifyLine = "    server s1 127.0.0.1:80 verify check";
    const verifyText = hoverMarkdown(
      `backend api\n${verifyLine}`,
      1,
      verifyLine.indexOf("verify"),
      "3.4",
    );
    expect(verifyText.toLowerCase()).toContain("verify");
  });

  it("limits nested option span scanning before if conditions", () => {
    const line = "    server s1 127.0.0.1:80 check inter 2s if MYACL";
    const interCol = line.indexOf("inter");
    const text = hoverMarkdown(`backend api\n${line}`, 1, interCol, "3.4");
    expect(text.toLowerCase()).toContain("inter");
  });

  it("covers nested option span resolution edge cases", () => {
    const bundle = bundles["3.4"];
    const schema = structuredClone(bundle.schema);
    schema.keywords.testoptbreak = {
      name: "testoptbreak",
      sections: ["backend"],
      signatures: ["testoptbreak [<mode>]"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testoptbreak [<mode>]"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 0,
            max_args: 1,
            slots: [
              {
                enum: ["on", "off"],
                optional: true,
                value_kind: "enum",
                variadic: false,
              },
            ],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testoptbreak",
    ];
    const data = structuredClone(bundle.languageData);
    data.groups.server_options = [
      ...(data.groups.server_options ?? []),
      {
        name: "testoptbreak",
        description: "Optional enum option.",
        docsUrl: undefined,
        rulesets: [],
        signature: "testoptbreak [<mode>]",
      },
    ];

    const bogusLine = "    server s1 127.0.0.1:80 ws bogus";
    const wsCol = bogusLine.indexOf("ws");
    expect(hoverMarkdown(`backend api\n${bogusLine}`, 1, wsCol, "3.4").toLowerCase()).toContain(
      "ws",
    );
    provideHover(
      createDocument(`backend api\n${bogusLine}`),
      { line: 1, character: bogusLine.indexOf("bogus") + 2 } as never,
      bundle.languageData,
      bundle.schema,
    );

    const wsCheckLine = "    server s1 127.0.0.1:80 ws check";
    expect(
      hoverMarkdown(
        `backend api\n${wsCheckLine}`,
        1,
        wsCheckLine.indexOf("ws"),
        "3.4",
      ).toLowerCase(),
    ).toContain("ws");

    const cookieBogusLine = "    server s1 127.0.0.1:80 cookie app01 bogus";
    provideHover(
      createDocument(`backend api\n${cookieBogusLine}`),
      { line: 1, character: cookieBogusLine.indexOf("bogus") + 2 } as never,
      bundle.languageData,
      bundle.schema,
    );

    schema.keywords.testvalopt = {
      name: "testvalopt",
      sections: ["backend"],
      signatures: ["testvalopt <value>"],
      sources: [],
      contexts: [],
      arguments: [],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testvalopt",
    ];
    schema.keyword_groups.server_options_with_value = [
      ...(schema.keyword_groups.server_options_with_value ?? []),
      "testvalopt",
    ];
    data.groups.server_options = [
      ...(data.groups.server_options ?? []),
      {
        name: "testvalopt",
        description: "Value option.",
        docsUrl: undefined,
        rulesets: [],
        signature: "testvalopt <value>",
      },
    ];
    const valueNextOptionLine = "    server s1 127.0.0.1:80 testvalopt check";
    expect(
      provideHover(
        createDocument(`backend api\n${valueNextOptionLine}`),
        { line: 1, character: valueNextOptionLine.indexOf("testvalopt") + 2 } as never,
        data,
        schema,
      ),
    ).not.toBeNull();

    schema.keyword_groups.server_options.push("schemaless");
    const schemalessLine = "    server s1 127.0.0.1:80 schemaless";
    provideHover(
      createDocument(`backend api\n${schemalessLine}`),
      { line: 1, character: schemalessLine.indexOf("schemaless") + 2 } as never,
      data,
      schema,
    );

    const unknownLine = "    server s1 127.0.0.1:80 zzzunknown";
    provideHover(
      createDocument(`backend api\n${unknownLine}`),
      { line: 1, character: unknownLine.indexOf("zzzunknown") + 2 } as never,
      bundle.languageData,
      bundle.schema,
    );
  });

  it("documents value-taking nested options without argument models", () => {
    const doc = createDocument("backend api\n    server s1 127.0.0.1:80 testvalopt myval");
    const bundle = bundles["3.4"];
    const schema = structuredClone(bundle.schema);
    schema.keywords.testvalopt = {
      name: "testvalopt",
      sections: ["backend"],
      signatures: ["testvalopt <value>"],
      sources: [],
      contexts: [],
      arguments: [],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testvalopt",
    ];
    schema.keyword_groups.server_options_with_value = [
      ...(schema.keyword_groups.server_options_with_value ?? []),
      "testvalopt",
    ];
    const data = structuredClone(bundle.languageData);
    data.groups.server_options = [
      ...(data.groups.server_options ?? []),
      {
        name: "testvalopt",
        description: "Custom value option.",
        docsUrl: undefined,
        rulesets: [],
        signature: "testvalopt <value>",
      },
    ];
    const line = "    server s1 127.0.0.1:80 testvalopt myval";
    const hover = provideHover(
      doc,
      { line: 1, character: line.indexOf("myval") + 1 } as never,
      data,
      schema,
    );
    expect(hover).not.toBeNull();
    if (hover === null) {
      throw new Error("expected hover");
    }
    expect(hoverText(hover)).toContain("testvalopt");
  });

  it("covers resolveNestedLineOptionSpan nested exact-option return", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    schema.keywords.parentopt = {
      name: "parentopt",
      sections: ["backend"],
      signatures: ["parentopt <value> [<childopt>]"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["parentopt <value> [<childopt>]"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 3,
            slots: [
              {
                enum: [],
                optional: false,
                value_kind: "generic",
                variadic: false,
              },
              {
                enum: ["childopt"],
                optional: true,
                value_kind: "enum",
                variadic: false,
              },
              {
                enum: [],
                optional: false,
                value_kind: "generic",
                variadic: false,
              },
            ],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "parentopt",
      "childopt",
    ];
    const line = "    server s1 127.0.0.1:80 parentopt val childopt tail";
    const doc = createDocument(`backend api\n${line}`);
    const childCol = line.indexOf("childopt") + 3;
    const ctx = getDocumentContext(doc, { line: 1, character: childCol } as never, schema);
    expect(ctx).not.toBeNull();
    if (ctx === null) {
      throw new Error("expected document context");
    }
    expect(ctx.tokenIndex).toBeGreaterThan(3);
    expect(ctx.token?.text.toLowerCase()).toBe("childopt");
    const active = resolveNestedLineOptionSpan(schema, ctx, "server_options", 3);
    expect(active?.keyword).toBe("childopt");
    expect(active?.optionIndex).toBe(ctx.tokenIndex);
    if (active === null) {
      throw new Error("expected nested line option span");
    }
    expect(active.optionIndex).toBeGreaterThan(3);
  });

  it("covers addSectionExtra with empty sections", () => {
    const extras: string[] = [];
    addSectionExtra(extras, undefined);
    addSectionExtra(extras, []);
    expect(extras).toEqual([]);
  });

  it("pads dconv table rows with fewer columns than the header", () => {
    const formatted = formatHoverText(
      ["Col A | Col B | Col C", "------+------+------", "x | y"].join("\n"),
    );
    expect(formatted).toContain("| Col A | Col B | Col C |");
    expect(formatted).toContain("| x | y |  |");
  });

  describe("option and action hover handlers", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("tryOptionHover rejects invalid contexts", () => {
      expect(
        tryOptionHover(
          optionHoverContext("httplog", {
            kind: "directive",
          }),
        ),
      ).toBeNull();
      expect(
        tryOptionHover(
          optionHoverContext("httplog", {
            tokenIndex: 0,
            token: { text: "option", start: 4, end: 10 },
          }),
        ),
      ).toBeNull();
    });

    it("tryOptionHover uses language keyword metadata", () => {
      const hover = tryOptionHover(optionHoverContext("httplog"));
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      const text = hoverText(hover);
      expect(text).toContain("option httplog");
      expect(text).toContain("option httplog [ clf ]");
      expect(text).toContain("Enable logging of HTTP request");
      expect(text).toContain("Valid in sections:");
      expect(text).toContain("Valid in modes:");
      expect(text).toContain("[HAProxy documentation](");
    });

    it("tryOptionHover resolves no-option keywords", () => {
      vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockImplementation((_data, keyword) => {
        if (keyword === "no option httplog") {
          return bundles["3.4"].languageData.keywords["option httplog"];
        }
        return undefined;
      });

      const hover = tryOptionHover(optionHoverContext("httplog"));
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      expect(hoverText(hover)).toContain("Enable logging of HTTP request");
    });

    it("tryOptionHover uses group metadata when language lookup misses", () => {
      const data = structuredClone(bundles["3.4"].languageData);
      data.groups.options = [
        {
          name: "groupopt",
          description: "Group-only option docs.",
          docsUrl: "https://example.test/groupopt",
          rulesets: [],
          signature: "option groupopt",
        },
      ];
      vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockReturnValue(undefined);

      const hover = tryOptionHover({
        ...optionHoverContext("groupopt"),
        data,
      });
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      const text = hoverText(hover);
      expect(text).toContain("option groupopt");
      expect(text).toContain("Group-only option docs.");
      expect(text).toContain("https://example.test/groupopt");
    });

    it("tryOptionHover leaves description empty when no docs exist", () => {
      vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockReturnValue({
        name: "option emptydesc",
        sections: [],
        signatures: ["option emptydesc"],
        arguments: [],
      } as never);

      const hover = tryOptionHover(optionHoverContext("emptydesc"));
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      expect(hoverText(hover)).toBe("**option emptydesc**\n\n`option emptydesc`");
    });

    it("tryOptionHover falls back to schema option contexts and token text", () => {
      const bundle = bundles["3.4"];
      const schema = structuredClone(bundle.schema);
      schema.keyword_group_contexts = {
        ...schema.keyword_group_contexts,
        options: {
          ...schema.keyword_group_contexts?.options,
          customopt: ["tcp", "http"],
        },
      };
      vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockReturnValue({
        name: "option customopt",
        description: "Custom option.",
        sections: ["defaults"],
        signatures: [],
        arguments: [],
      } as never);
      vi.spyOn(directiveUtils, "getKeywordFromSchema").mockReturnValue(undefined);

      const hover = tryOptionHover({
        ...optionHoverContext("customopt"),
        schema,
      });
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      const text = hoverText(hover);
      expect(text).toContain("option customopt");
      expect(text).toContain("Custom option.");
      expect(text).toContain("**Valid in modes:** tcp, http");
    });

    it("tryActionHover documents actions with and without rulesets", () => {
      const denyHover = tryActionHover(actionHoverContext("deny"));
      expect(denyHover).not.toBeNull();
      if (denyHover === null) {
        throw new Error("expected hover");
      }
      const denyText = hoverText(denyHover);
      expect(denyText.toLowerCase()).toContain("deny");
      expect(denyText).toContain("**Rulesets:** http-request, http-response");

      const closeHover = tryActionHover(actionHoverContext("close"));
      expect(closeHover).not.toBeNull();
      if (closeHover === null) {
        throw new Error("expected hover");
      }
      expect(hoverText(closeHover)).not.toContain("**Rulesets:**");
    });

    it("tryActionHover scans later action groups and rejects unknown actions", () => {
      const attachHover = tryActionHover(actionHoverContext("attach-srv"));
      expect(attachHover).not.toBeNull();
      if (attachHover === null) {
        throw new Error("expected hover");
      }
      expect(hoverText(attachHover)).toContain("attach-srv");

      expect(tryActionHover(actionHoverContext("not-a-real-action"))).toBeNull();
    });
  });
});
