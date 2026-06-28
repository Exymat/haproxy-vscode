import * as documentContext from "../../src/documentContext";
import { provideCompletionItems } from "../../src/completion";
import { createDocument } from "../helpers/document";
import { bundle, completionLabels, mockOptionsGroupItems } from "./completion/helpers";

describe("completion documentation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds keyword docs when descriptions and signatures are sparse", () => {
    const doc = createDocument("frontend web\n    ");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      kind: "directive",
      tokenIndex: 0,
      line: { line: 1, text: "    ", indent: 4, section: "frontend", tokens: [] },
    } as never);
    vi.spyOn(documentContext, "keywordsForSection").mockReturnValue([
      { name: "fake-keyword", signatures: [], description: "", docsUrl: undefined, arguments: [] },
    ] as never);
    expect(
      provideCompletionItems(
        doc,
        { line: 1, character: 4 } as never,
        bundle.languageData,
        bundle.schema,
      )[0]?.detail,
    ).toBe("fake-keyword");
  });

  it("builds option documentation from keyword and group fallbacks", () => {
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
    expect(
      provideCompletionItems(doc, { line: 1, character: 17 } as never, data, bundle.schema)[0]
        ?.documentation,
    ).toBeDefined();
  });

  it("uses group and direct keyword docs when available", () => {
    const groupedDoc = createDocument("defaults\n    option grouped");
    const groupedData = structuredClone(bundle.languageData);
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
    groupedData.keywords["option grouped"] = {
      name: "option grouped",
      signatures: ["option grouped"],
      sections: ["defaults"],
      description: "",
      docsUrl: undefined,
      arguments: [],
    } as never;
    expect(
      provideCompletionItems(
        groupedDoc,
        { line: 1, character: 18 } as never,
        groupedData,
        bundle.schema,
      )[0]?.documentation,
    ).toBeDefined();

    vi.restoreAllMocks();
    const directDoc = createDocument("defaults\n    option directdoc");
    const directData = structuredClone(bundle.languageData);
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
    directData.keywords["option directdoc"] = {
      name: "option directdoc",
      signatures: ["option directdoc"],
      sections: ["defaults"],
      description: "Keyword description",
      docsUrl: "https://example.test/directdoc",
      arguments: [],
    };
    expect(
      provideCompletionItems(
        directDoc,
        { line: 1, character: 20 } as never,
        directData,
        bundle.schema,
      )[0]?.documentation,
    ).toBeDefined();
  });

  it("covers expression-converter and log-format completion docs", () => {
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
    vi.spyOn(documentContext, "groupItems").mockImplementation((groupData, group) => {
      if (group === "sample_converters") {
        return [{ name: "lower", description: "to lower", rulesets: [] }] as never;
      }
      return originalGroupItems(groupData, group);
    });
    expect(
      provideCompletionItems(
        doc,
        { line: 1, character: content.split("\n")[1].length } as never,
        data,
        bundle.schema,
      ).map((i) => i.label),
    ).toContain("lower");
    vi.restoreAllMocks();
    expect(completionLabels('defaults\n    log-format "%c', 1)).toContain("ci");
    expect(completionLabels('defaults\n    log-format "%{+', 1)).toEqual(
      expect.arrayContaining(["Q", "E", "X"]),
    );
    const items = provideCompletionItems(
      createDocument('defaults\n    log-format "%ci'),
      { line: 1, character: '    log-format "%ci'.length } as never,
      bundle.languageData,
      bundle.schema,
    );
    const ci = items.find((item) => item.label === "ci");
    expect(ci?.detail).toBe("%ci");
    expect(ci?.documentation).toBeDefined();
  });
});
