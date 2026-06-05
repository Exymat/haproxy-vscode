import {
  clearLanguageDataCache,
  findKeywordByPrefix,
  loadLanguageData,
} from "../../src/languageData";
import { resetVscodeMock } from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";
import { loadLanguageData as loadFixtureLanguageData } from "../helpers/schema";

describe("loadLanguageData", () => {
  beforeEach(() => {
    resetVscodeMock();
    clearLanguageDataCache();
  });

  it("loads and caches language data by version", () => {
    const context = mockExtensionContext();
    const first = loadLanguageData(context as never, "3.2");
    const second = loadLanguageData(context as never, "3.2");
    expect(first).toBe(second);
    expect(first.version).toBe("3.2");
    expect(first.keywords.mode).toBeDefined();
  });

  it("returns fresh data after cache clear", () => {
    const context = mockExtensionContext();
    const before = loadLanguageData(context as never, "3.4");
    clearLanguageDataCache();
    const after = loadLanguageData(context as never, "3.4");
    expect(after).not.toBe(before);
    expect(after.version).toBe("3.4");
  });
});

describe("findKeywordByPrefix", () => {
  const data = loadFixtureLanguageData("3.4");

  it("returns exact keyword match", () => {
    const hit = findKeywordByPrefix(data, "mode");
    expect(hit?.name).toBe("mode");
  });

  it("returns longest prefix match", () => {
    const hit = findKeywordByPrefix(data, "tcp-request connection accept");
    expect(hit?.name).toBe("tcp-request connection");
  });

  it("returns undefined when no keyword matches", () => {
    expect(findKeywordByPrefix(data, "zzzznotakeyword")).toBeUndefined();
    expect(findKeywordByPrefix(data, "")).toBeUndefined();
  });
});
