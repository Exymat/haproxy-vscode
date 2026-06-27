import {
  actionGroupForCompletionKind,
  lineOptionGroupForKind,
  sampleExpressionGroupForKind,
} from "../../src/domainMaps";
import {
  clearLanguageDataIndexCache,
  findIndexedGroupItem,
  indexedGroupItems,
  indexedKeywordsForSection,
  indexedResolvedKeywordsForSection,
  languageDataIndexes,
} from "../../src/languageDataIndexes";
import { loadLanguageData } from "../helpers/schema";

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
});

describe("domainMaps", () => {
  it("maps completion kinds to domain groups", () => {
    expect(actionGroupForCompletionKind("http-request")).toBe("http_request_actions");
    expect(actionGroupForCompletionKind("unknown-kind")).toBeNull();
    expect(lineOptionGroupForKind("bind")).toBe("bind_options");
    expect(lineOptionGroupForKind("server")).toBe("server_options");
    expect(lineOptionGroupForKind("frontend")).toBeNull();
    expect(sampleExpressionGroupForKind("expression-fetch")).toBe("sample_fetches");
    expect(sampleExpressionGroupForKind("expression-converter")).toBe("sample_converters");
    expect(sampleExpressionGroupForKind("none")).toBeNull();
  });
});
