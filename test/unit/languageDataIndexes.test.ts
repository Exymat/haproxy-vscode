import {
  actionGroupForCompletionKind,
  lineOptionGroupForKind,
  sampleExpressionGroupForKind,
} from "../../src/schema/semantic";
import {
  clearLanguageDataIndexCache,
  findIndexedGroupItem,
  indexedGroupItems,
  indexedGroupItemsByName,
  indexedKeywordNameSetForSection,
  indexedKeywordsForSection,
  indexedResolvedKeywordsForSection,
  languageDataIndexes,
} from "../../src/languageDataIndexes";
import { loadLanguageData, loadSchema } from "../helpers/schema";

describe("languageDataIndexes", () => {
  const data = loadLanguageData("3.2");

  beforeEach(() => {
    clearLanguageDataIndexCache();
  });

  it("builds and caches indexes per language data object", () => {
    const first = languageDataIndexes(data);
    const second = languageDataIndexes(data);
    expect(first).toBe(second);
    expect(first.keywordsBySection.get("frontend")?.length).toBeGreaterThan(0);
  });

  it("clears index cache independently", () => {
    languageDataIndexes(data);
    clearLanguageDataIndexCache();
    const rebuilt = languageDataIndexes(data);
    expect(rebuilt.keywordsBySection.size).toBeGreaterThan(0);
  });

  it("indexedGroupItems returns group members or empty array", () => {
    expect(indexedGroupItems(data, "options").length).toBeGreaterThan(0);
    expect(indexedGroupItems(data, "missing-group")).toEqual([]);
  });

  it("findIndexedGroupItem resolves exact and case-insensitive names", () => {
    const exact = findIndexedGroupItem(data, "options", "abortonclose");
    expect(exact?.name).toBe("abortonclose");
    const lower = findIndexedGroupItem(data, "options", "ABORTONCLOSE");
    expect(lower?.name).toBe("abortonclose");
    expect(findIndexedGroupItem(data, "options", "not-an-option")).toBeUndefined();
  });

  it("indexedKeywordsForSection handles null section", () => {
    expect(indexedKeywordsForSection(data, null)).toEqual([]);
  });

  it("indexedResolvedKeywordsForSection handles null section", () => {
    expect(indexedResolvedKeywordsForSection(data, null)).toEqual([]);
  });

  it("indexedResolvedKeywordsForSection returns empty for unknown section", () => {
    expect(indexedResolvedKeywordsForSection(data, "nonexistent-section")).toEqual([]);
  });

  it("indexedKeywordNameSetForSection handles null section", () => {
    expect(indexedKeywordNameSetForSection(data, null)).toEqual(new Set());
  });

  it("returns empty indexes for unknown groups and sections", () => {
    expect(indexedGroupItemsByName(data, "missing-group")).toEqual(new Map());
    expect(indexedKeywordsForSection(data, "missing-section")).toEqual([]);
    expect(indexedKeywordNameSetForSection(data, "missing-section")).toEqual(new Set());
  });

  it("skips keywords whose variants do not resolve for a section", () => {
    const custom = structuredClone(data);
    custom.keywords.sectiononly = {
      name: "sectiononly",
      sections: ["frontend"],
      signatures: ["sectiononly"],
      arguments: [],
      description: "",
      docsUrl: "",
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["sectiononly backend"],
          arguments: [],
          description: "",
          docsUrl: "",
        },
      ],
    };
    clearLanguageDataIndexCache();
    const resolved = indexedResolvedKeywordsForSection(custom, "frontend");
    expect(resolved.some((kw) => kw.name === "sectiononly")).toBe(true);
  });

  it("ignores keywords without sections when building section indexes", () => {
    const custom = structuredClone(data);
    const invalidKeyword = {
      name: "nosections",
      signatures: ["nosections"],
      arguments: [],
      description: "",
      docsUrl: "",
    };
    (custom.keywords as Record<string, unknown>).nosections = invalidKeyword;
    clearLanguageDataIndexCache();
    const indexes = languageDataIndexes(custom);
    expect(indexes.keywordsBySection.get("frontend")?.some((kw) => kw.name === "nosections")).toBe(
      false,
    );
  });
});

describe("domainMaps", () => {
  it("maps completion kinds to domain groups", () => {
    const schema = loadSchema("3.2");
    expect(actionGroupForCompletionKind(schema, "http-request")).toBe("http_request_actions");
    expect(actionGroupForCompletionKind(schema, "unknown-kind")).toBeNull();
    expect(lineOptionGroupForKind(schema, "bind")).toBe("bind_options");
    expect(lineOptionGroupForKind(schema, "server")).toBe("server_options");
    expect(lineOptionGroupForKind(schema, "frontend")).toBeNull();
    expect(sampleExpressionGroupForKind(schema, "expression-fetch")).toBe("sample_fetches");
    expect(sampleExpressionGroupForKind(schema, "expression-converter")).toBe("sample_converters");
    expect(sampleExpressionGroupForKind(schema, "none")).toBeNull();
  });
});
