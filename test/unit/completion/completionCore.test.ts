import { provideCompletionItems } from "../../../src/completion";
import { tryDirectiveArgumentCompletion } from "../../../src/completion/handlers/directiveArgument";
import * as documentContext from "../../../src/parser/documentContext";
import * as directiveUtils from "../../../src/language/directiveUtils";
import * as lineSemanticContext from "../../../src/parser/lineSemanticContext";
import { createDocument } from "../../helpers/document";
import { cursorAtLineEnd } from "../../helpers/cursor";
import { bundle, completionLabels } from "./helpers";

describe("completion core", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suggests section headers at file start", async () => {
    const labels = await completionLabels("", 0, 0);
    expect(labels).toEqual(expect.arrayContaining(["global", "defaults", "frontend", "backend"]));
  });

  it("suggests section headers while typing partial names", async () => {
    expect(await completionLabels("global", 0, 1)).toEqual(expect.arrayContaining(["global"]));
    expect(await completionLabels("fron", 0)).toEqual(["frontend"]);
    expect(await completionLabels("back", 0)).toEqual(expect.arrayContaining(["backend"]));
    expect(await completionLabels("fron", 0)).not.toContain("backend");
  });

  it("suggests section headers between sections but not on indented blank lines", async () => {
    expect(await completionLabels("global\n    daemon\n", 2, 0)).toEqual(
      expect.arrayContaining(["frontend", "backend", "defaults"]),
    );
    const indentedBlank = "defaults\n    mode http\n    \n    balance roundrobin";
    expect(await completionLabels(indentedBlank, 2, 4)).toEqual(
      expect.arrayContaining(["balance"]),
    );
    expect(await completionLabels(indentedBlank, 2, 4)).not.toContain("frontend");
  });

  it("returns no completions when document context is null", async () => {
    expect(await completionLabels("frontend web", 0, "frontend web".indexOf("web"))).toEqual([]);
  });

  it("suggests from after named from-capable section headers", async () => {
    expect(await completionLabels("frontend web ", 0)).toEqual(["from"]);
    expect(await completionLabels("backend api ", 0)).toEqual(["from"]);
    expect(await completionLabels("listen app ", 0)).toEqual(["from"]);
    expect(await completionLabels("defaults ", 0)).toEqual(["from"]);
    expect(await completionLabels("defaults myname ", 0)).toEqual(["from"]);
    expect(await completionLabels("frontend web fr", 0)).toEqual(["from"]);
    expect(await completionLabels("defaults fr", 0)).toEqual(["from"]);
  });

  it("does not suggest from after sections that cannot inherit", async () => {
    expect(await completionLabels("cache foo ", 0)).toEqual([]);
    expect(await completionLabels("peers p1 ", 0)).toEqual([]);
    expect(await completionLabels("frontend ", 0)).toEqual([]);
    expect(
      await completionLabels("defaults myname", 0, "defaults myname".indexOf("myname")),
    ).toEqual([]);
  });

  it("suggests option names", async () => {
    expect(await completionLabels("defaults\n    no option ", 1)).toEqual(
      expect.arrayContaining(["httplog", "forwardfor"]),
    );
  });

  it("suggests services after http-request use-service", async () => {
    const origGroupItems = documentContext.groupItems;
    vi.spyOn(documentContext, "groupItems").mockImplementation((data, group) => {
      if (group === "services") {
        return [{ name: "ping", description: "ping service", signature: "ping", rulesets: [] }];
      }
      return origGroupItems(data, group);
    });
    expect(await completionLabels("frontend web\n    http-request use-service ", 1)).toContain(
      "ping",
    );
  });

  it("requires use-service metadata", async () => {
    const schema = structuredClone(bundle.schema);
    schema.semantic_groups = { ...schema.semantic_groups, use_service: [] };
    const doc = createDocument("frontend web\n    http-request use-service ");
    await expect(
      provideCompletionItems(
        doc,
        cursorAtLineEnd("frontend web\n    http-request use-service ", 1),
        bundle.languageData,
        schema,
      ),
    ).rejects.toThrow(/semantic_groups\.use_service/);

    const malformed = structuredClone(bundle.schema);
    malformed.semantic_groups = {
      ...malformed.semantic_groups,
      use_service: { rule_kinds: ["http-request"], action: 1, service_group: "services" },
    };
    await expect(
      provideCompletionItems(
        doc,
        cursorAtLineEnd("frontend web\n    http-request use-service ", 1),
        bundle.languageData,
        malformed,
      ),
    ).rejects.toThrow(/semantic_groups\.use_service/);

    malformed.semantic_groups = {
      ...malformed.semantic_groups,
      use_service: { rule_kinds: "http-request", action: "use-service", service_group: "services" },
    };
    await expect(
      provideCompletionItems(
        doc,
        cursorAtLineEnd("frontend web\n    http-request use-service ", 1),
        bundle.languageData,
        malformed,
      ),
    ).rejects.toThrow(/semantic_groups\.use_service/);
  });

  it("suggests action, filter, expression, and acl completions", async () => {
    expect(await completionLabels("frontend web\n    tcp-request connection ", 1)).not.toContain(
      "acl",
    );
    expect((await completionLabels("backend api\n    filter ", 1)).length).toBeGreaterThan(0);
    expect(
      (await completionLabels("frontend web\n    http-request set-header X %[req.", 1)).length,
    ).toBeGreaterThan(0);
    expect(
      (await completionLabels("frontend web\n    http-request set-header X %[path(0):", 1)).length,
    ).toBeGreaterThan(0);
    expect(await completionLabels("frontend web\n    acl test ", 1)).toEqual(
      expect.arrayContaining(["path", "hdr"]),
    );
  });

  it("handles empty and non-matching directive-argument contexts", async () => {
    expect(await completionLabels("defaults\n    notadirective ", 1)).toEqual([]);

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

  it("covers directive and ruleset completions", async () => {
    expect(await completionLabels("frontend web\n    bi", 1)).toEqual(
      expect.arrayContaining(["bind"]),
    );
    expect(
      await completionLabels(
        "frontend web\n    http-request set",
        1,
        "    http-request set".indexOf("set"),
      ),
    ).toEqual(expect.arrayContaining(["set-header", "add-header"]));
    expect(
      await completionLabels(
        "frontend web\n    http-response set",
        1,
        "    http-response set".indexOf("set"),
      ),
    ).toEqual(expect.arrayContaining(["set-header", "add-header"]));
    expect(
      await completionLabels(
        "frontend web\n    http-after-response set",
        1,
        "    http-after-response set".indexOf("set"),
      ),
    ).toEqual(expect.arrayContaining(["set-header", "add-header"]));
    expect(await completionLabels("frontend web\n    tcp-response content ", 1)).not.toContain(
      "acl",
    );
  });

  it("handles line-option and bind token edge cases", async () => {
    expect(
      (await completionLabels("backend api\n    filter", 1, "    filter".indexOf("filter"))).length,
    ).toBeGreaterThan(0);
    expect(
      await completionLabels(
        "frontend web\n    bind :80 extra",
        1,
        "    bind :80 extra".indexOf("extra"),
      ),
    ).not.toContain("bind");
    expect(
      await completionLabels(
        "frontend web\n    bind 192.168.1.22:80, :81, 192.168.1.23:82 ",
        1,
        "    bind 192.168.1.22:80, :81, 192.168.1.23:82 ".indexOf(":81") + 1,
      ),
    ).toEqual([]);
    expect(
      await completionLabels("backend api\n    server s1 127.0.0.1:80 cookie app01 ins", 1),
    ).toEqual(expect.arrayContaining(["insert"]));
  });

  it("covers directive-kind and schema-missing fallback paths", async () => {
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
    expect(await completionLabels("defaults\n    mode http junk", 1, 14)).toEqual([]);

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
