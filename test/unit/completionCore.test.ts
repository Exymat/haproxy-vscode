import { tryDirectiveArgumentCompletion } from "../../src/completion/handlers/directiveArgument";
import * as documentContext from "../../src/documentContext";
import * as directiveUtils from "../../src/directiveUtils";
import * as lineSemanticContext from "../../src/lineSemanticContext";
import { createDocument } from "../helpers/document";
import { cursorAtLineEnd } from "../helpers/cursor";
import { bundle, completionLabels } from "./completion/helpers";

describe("completion core", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suggests section headers at file start", () => {
    const labels = completionLabels("", 0, 0);
    expect(labels).toEqual(expect.arrayContaining(["global", "defaults", "frontend", "backend"]));
  });

  it("suggests section headers while typing partial names", () => {
    expect(completionLabels("global", 0, 1)).toEqual(expect.arrayContaining(["global"]));
    expect(completionLabels("fron", 0)).toEqual(["frontend"]);
    expect(completionLabels("back", 0)).toEqual(expect.arrayContaining(["backend"]));
    expect(completionLabels("fron", 0)).not.toContain("backend");
  });

  it("suggests section headers between sections but not on indented blank lines", () => {
    expect(completionLabels("global\n    daemon\n", 2, 0)).toEqual(
      expect.arrayContaining(["frontend", "backend", "defaults"]),
    );
    const indentedBlank = "defaults\n    mode http\n    \n    balance roundrobin";
    expect(completionLabels(indentedBlank, 2, 4)).toEqual(expect.arrayContaining(["balance"]));
    expect(completionLabels(indentedBlank, 2, 4)).not.toContain("frontend");
  });

  it("returns no completions when document context is null", () => {
    expect(completionLabels("frontend web", 0, "frontend web".indexOf("web"))).toEqual([]);
  });

  it("suggests option names", () => {
    expect(completionLabels("defaults\n    no option ", 1)).toEqual(
      expect.arrayContaining(["httplog", "forwardfor"]),
    );
  });

  it("suggests services after http-request use-service", () => {
    const origGroupItems = documentContext.groupItems;
    vi.spyOn(documentContext, "groupItems").mockImplementation((data, group) => {
      if (group === "services") {
        return [{ name: "ping", description: "ping service", signature: "ping", rulesets: [] }];
      }
      return origGroupItems(data, group);
    });
    expect(completionLabels("frontend web\n    http-request use-service ", 1)).toContain("ping");
  });

  it("suggests action, filter, expression, and acl completions", () => {
    expect(completionLabels("frontend web\n    tcp-request connection ", 1)).not.toContain("acl");
    expect(completionLabels("backend api\n    filter ", 1).length).toBeGreaterThan(0);
    expect(
      completionLabels("frontend web\n    http-request set-header X %[req.", 1).length,
    ).toBeGreaterThan(0);
    expect(
      completionLabels("frontend web\n    http-request set-header X %[path(0):", 1).length,
    ).toBeGreaterThan(0);
    expect(completionLabels("frontend web\n    acl test ", 1)).toEqual(
      expect.arrayContaining(["path", "hdr"]),
    );
  });

  it("handles empty and non-matching directive-argument contexts", () => {
    expect(completionLabels("defaults\n    notadirective ", 1)).toEqual([]);

    const doc = createDocument("defaults\n    mode ");
    vi.spyOn(lineSemanticContext, "getLineSemanticContext").mockReturnValue(null);
    const items = tryDirectiveArgumentCompletion({
      document: doc,
      position: cursorAtLineEnd("defaults\n    mode ", 1),
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

  it("covers directive and ruleset completions", () => {
    expect(completionLabels("frontend web\n    bi", 1)).toEqual(expect.arrayContaining(["bind"]));
    expect(
      completionLabels(
        "frontend web\n    http-request set",
        1,
        "    http-request set".indexOf("set"),
      ),
    ).toEqual(expect.arrayContaining(["set-header", "add-header"]));
    expect(
      completionLabels(
        "frontend web\n    http-response set",
        1,
        "    http-response set".indexOf("set"),
      ),
    ).toEqual(expect.arrayContaining(["set-header", "add-header"]));
    expect(
      completionLabels(
        "frontend web\n    http-after-response set",
        1,
        "    http-after-response set".indexOf("set"),
      ),
    ).toEqual(expect.arrayContaining(["set-header", "add-header"]));
    expect(completionLabels("frontend web\n    tcp-response content ", 1)).not.toContain("acl");
  });

  it("handles line-option and bind token edge cases", () => {
    expect(
      completionLabels("backend api\n    filter", 1, "    filter".indexOf("filter")).length,
    ).toBeGreaterThan(0);
    expect(
      completionLabels(
        "frontend web\n    bind :80 extra",
        1,
        "    bind :80 extra".indexOf("extra"),
      ),
    ).not.toContain("bind");
    expect(
      completionLabels(
        "frontend web\n    bind 192.168.1.22:80, :81, 192.168.1.23:82 ",
        1,
        "    bind 192.168.1.22:80, :81, 192.168.1.23:82 ".indexOf(":81") + 1,
      ),
    ).toEqual([]);
    expect(completionLabels("backend api\n    server s1 127.0.0.1:80 cookie app01 ins", 1)).toEqual(
      expect.arrayContaining(["insert"]),
    );
  });

  it("covers directive-kind and schema-missing fallback paths", () => {
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
    expect(completionLabels("defaults\n    mode http junk", 1, 14)).toEqual([]);

    vi.restoreAllMocks();
    const doc2 = createDocument("defaults\n    mode ");
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
    const items = tryDirectiveArgumentCompletion({
      document: doc2,
      position: cursorAtLineEnd("defaults\n    mode ", 1),
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: documentContext.getDocumentContext(
        doc2,
        cursorAtLineEnd("defaults\n    mode ", 1),
        bundle.schema,
      ) as never,
      partial: "",
    });
    expect(items).not.toBeNull();
    if (!items) {
      throw new Error("expected completion items");
    }
    expect(items).toHaveLength(1);
    expect(items[0]?.detail).toBe("argument");
  });
});
