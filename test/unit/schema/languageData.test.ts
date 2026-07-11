import * as fs from "node:fs";

import {
  clearLanguageDataCache,
  findKeywordByPrefix,
  loadLanguageData,
  loadLanguageDataAsync,
} from "../../../src/language/languageData";
import { resetMockVscode } from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";
import { loadLanguageData as loadFixtureLanguageData } from "../../helpers/schema";
import { createTempSchemaFixture } from "../../helpers/tempSchema";

describe("loadLanguageData", () => {
  beforeEach(() => {
    resetMockVscode();
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

  it("throws when language data file is missing", () => {
    expect(() => loadLanguageData({ extensionPath: "/nonexistent" } as never, "3.4")).toThrow(
      /Failed to load HAProxy language data for 3\.4/,
    );
  });

  it("throws when async language data load fails", async () => {
    await expect(
      loadLanguageDataAsync({ extensionPath: "/nonexistent" } as never, "3.4"),
    ).rejects.toThrow(/Failed to load HAProxy language data for 3\.4/);
  });

  it("wraps non-Error throws from async language data load", async () => {
    const context = mockExtensionContext();
    const readSpy = vi.spyOn(fs.promises, "readFile").mockRejectedValue("async-boom");
    await expect(loadLanguageDataAsync(context as never, "3.4")).rejects.toThrow(
      /Failed to load HAProxy language data.*async-boom/,
    );
    readSpy.mockRestore();
  });

  it("throws when sync language data file contains invalid JSON", () => {
    clearLanguageDataCache();
    const fixture = createTempSchemaFixture("haproxy-language-error-", {
      "haproxy-3.4.language.json": "{not-json",
    });
    try {
      expect(() =>
        loadLanguageData({ extensionPath: fixture.extensionPath } as never, "3.4"),
      ).toThrow(/Failed to load HAProxy language data for 3\.4/);
    } finally {
      fixture.cleanup();
    }
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
