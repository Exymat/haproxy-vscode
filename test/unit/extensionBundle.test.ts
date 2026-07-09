import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BundleLoadStaleError,
  createBundleLoader,
  getLoadedBundle,
  getLoadedBundleForUri,
  invalidateBundleLoad,
} from "../../src/extensionBundle";
import * as languageData from "../../src/languageData";
import * as outputChannel from "../../src/outputChannel";
import * as schema from "../../src/schema";
import { resetVscodeMock, setMockConfigForUri } from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";
import { loadSchemaBundle } from "../helpers/schema";

const fixture = loadSchemaBundle("3.2");
const fixture34 = loadSchemaBundle("3.4");

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe("extensionBundle", () => {
  beforeEach(() => {
    resetVscodeMock();
    invalidateBundleLoad();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    invalidateBundleLoad();
    await flushImmediate();
    vi.restoreAllMocks();
  });

  it("resolves a successful load once and caches the bundle per version", async () => {
    const schemaSpy = vi.spyOn(schema, "loadSchemaAsync").mockResolvedValue(fixture.schema);
    const languageSpy = vi
      .spyOn(languageData, "loadLanguageDataAsync")
      .mockResolvedValue(fixture.languageData);
    const { ensureBundle } = createBundleLoader(mockExtensionContext() as never);

    const first = await ensureBundle("3.2");
    const second = await ensureBundle("3.2");

    expect(first).toBe(second);
    expect(first.version).toBe("3.2");
    expect(getLoadedBundle("3.2")).toBe(first);
    expect(schemaSpy).toHaveBeenCalledTimes(1);
    expect(languageSpy).toHaveBeenCalledTimes(1);
  });

  it("loads and caches different versions independently", async () => {
    const schemaSpy = vi
      .spyOn(schema, "loadSchemaAsync")
      .mockImplementation((_context, version) =>
        Promise.resolve(version === "3.4" ? fixture34.schema : fixture.schema),
      );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockImplementation((_context, version) =>
      Promise.resolve(version === "3.4" ? fixture34.languageData : fixture.languageData),
    );
    const { ensureBundle } = createBundleLoader(mockExtensionContext() as never);

    const bundle32 = await ensureBundle("3.2");
    const bundle34 = await ensureBundle("3.4");

    expect(bundle32.version).toBe("3.2");
    expect(bundle34.version).toBe("3.4");
    expect(getLoadedBundle("3.2")).toBe(bundle32);
    expect(getLoadedBundle("3.4")).toBe(bundle34);
    expect(schemaSpy).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight promise across concurrent ensureBundle calls", async () => {
    let resolveSchema!: (value: schema.HaproxySchema) => void;
    const schemaSpy = vi.spyOn(schema, "loadSchemaAsync").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSchema = resolve;
        }),
    );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(fixture.languageData);
    const { ensureBundle } = createBundleLoader(mockExtensionContext() as never);

    const pendingA = ensureBundle("3.2");
    const pendingB = ensureBundle("3.2");
    await flushImmediate();

    expect(pendingA).toBe(pendingB);
    expect(schemaSpy).toHaveBeenCalledTimes(1);

    resolveSchema(fixture.schema);
    const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
    expect(resultA).toBe(resultB);
  });

  it("rejects an in-flight load immediately when invalidated", async () => {
    let resolveSchema!: (value: schema.HaproxySchema) => void;
    vi.spyOn(schema, "loadSchemaAsync").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSchema = resolve;
        }),
    );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(fixture.languageData);
    const { ensureBundle, invalidate } = createBundleLoader(mockExtensionContext() as never);

    const pending = ensureBundle("3.2");
    await flushImmediate();
    invalidate("3.2");

    await expect(pending).rejects.toBeInstanceOf(BundleLoadStaleError);
    expect(getLoadedBundle("3.2")).toBeUndefined();

    resolveSchema(fixture.schema);
    await flushImmediate();
    expect(getLoadedBundle("3.2")).toBeUndefined();
  });

  it("invalidates only the targeted version", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockImplementation((_context, version) =>
      Promise.resolve(version === "3.4" ? fixture34.schema : fixture.schema),
    );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockImplementation((_context, version) =>
      Promise.resolve(version === "3.4" ? fixture34.languageData : fixture.languageData),
    );
    const { ensureBundle, invalidate } = createBundleLoader(mockExtensionContext() as never);

    const bundle32 = await ensureBundle("3.2");
    const bundle34 = await ensureBundle("3.4");
    invalidate("3.2");

    expect(getLoadedBundle("3.2")).toBeUndefined();
    expect(getLoadedBundle("3.4")).toBe(bundle34);

    const reloaded = await ensureBundle("3.2");
    expect(reloaded).not.toBe(bundle32);
    expect(reloaded.version).toBe("3.2");
  });

  it("rejects an in-flight load when invalidated after schema resolves", async () => {
    let resolveSchema!: (value: schema.HaproxySchema) => void;
    vi.spyOn(schema, "loadSchemaAsync").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSchema = resolve;
        }),
    );
    let resolveLanguage!: (value: languageData.HaproxyLanguageData) => void;
    vi.spyOn(languageData, "loadLanguageDataAsync").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLanguage = resolve;
        }),
    );
    const { ensureBundle, invalidate } = createBundleLoader(mockExtensionContext() as never);

    const pending = ensureBundle("3.2");
    await flushImmediate();
    resolveSchema(fixture.schema);
    await flushImmediate();
    invalidate("3.2");

    await expect(pending).rejects.toBeInstanceOf(BundleLoadStaleError);

    resolveLanguage(fixture.languageData);
    await flushImmediate();
    expect(getLoadedBundle("3.2")).toBeUndefined();
  });

  it("allows a fresh load after stale invalidation", async () => {
    let resolveSchema!: (value: schema.HaproxySchema) => void;
    const schemaSpy = vi.spyOn(schema, "loadSchemaAsync").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSchema = resolve;
        }),
    );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(fixture.languageData);
    const { ensureBundle, invalidate } = createBundleLoader(mockExtensionContext() as never);

    const stale = ensureBundle("3.4");
    await flushImmediate();
    invalidate("3.4");
    await expect(stale).rejects.toBeInstanceOf(BundleLoadStaleError);

    const fresh = ensureBundle("3.4");
    await flushImmediate();
    resolveSchema(fixture.schema);
    const loaded = await fresh;

    expect(loaded.version).toBe("3.4");
    expect(schemaSpy).toHaveBeenCalledTimes(2);
    expect(getLoadedBundle("3.4")).toBe(loaded);
  });

  it("stores bundle load errors and rejects subsequent calls until invalidate", async () => {
    const schemaSpy = vi
      .spyOn(schema, "loadSchemaAsync")
      .mockRejectedValue(new Error("schema load failed"));
    vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(fixture.languageData);
    const { ensureBundle, invalidate } = createBundleLoader(mockExtensionContext() as never);

    await expect(ensureBundle("3.2")).rejects.toThrow("schema load failed");
    await expect(ensureBundle("3.2")).rejects.toThrow("schema load failed");
    expect(schemaSpy).toHaveBeenCalledTimes(1);
    expect(getLoadedBundle("3.2")).toBeUndefined();

    invalidate("3.2");
    schemaSpy.mockResolvedValue(fixture.schema);
    const loaded = await ensureBundle("3.2");
    expect(loaded.version).toBe("3.2");
    expect(schemaSpy).toHaveBeenCalledTimes(2);
  });

  it("discards stale load errors without caching bundleLoadError", async () => {
    let rejectSchema!: (error: Error) => void;
    const schemaSpy = vi.spyOn(schema, "loadSchemaAsync").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSchema = reject;
        }),
    );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(fixture.languageData);
    const { ensureBundle, invalidate } = createBundleLoader(mockExtensionContext() as never);

    const pending = ensureBundle("3.2");
    await flushImmediate();
    invalidate("3.2");
    rejectSchema(new Error("late schema failure"));

    await expect(pending).rejects.toBeInstanceOf(BundleLoadStaleError);
    schemaSpy.mockResolvedValue(fixture.schema);
    const recovered = await ensureBundle("3.2");
    expect(recovered).toEqual(expect.objectContaining({ version: "3.2", schema: fixture.schema }));
  });

  it("rejects when language data load fails", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockResolvedValue(fixture.schema);
    vi.spyOn(languageData, "loadLanguageDataAsync").mockRejectedValue(new Error("language failed"));
    const { ensureBundle } = createBundleLoader(mockExtensionContext() as never);

    await expect(ensureBundle("3.2")).rejects.toThrow("language failed");
    expect(getLoadedBundle("3.2")).toBeUndefined();
  });

  it("wraps non-Error language load failures", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockResolvedValue(fixture.schema);
    vi.spyOn(languageData, "loadLanguageDataAsync").mockRejectedValue("language string failure");
    const { ensureBundle } = createBundleLoader(mockExtensionContext() as never);

    await expect(ensureBundle("3.2")).rejects.toThrow("language string failure");
  });

  it("loads bundle for a document URI version", async () => {
    const uri = { toString: () => "file:///workspace/app.cfg" };
    setMockConfigForUri(uri, "haproxy", "version", "3.4");
    vi.spyOn(schema, "loadSchemaAsync").mockImplementation((_context, version) =>
      Promise.resolve(version === "3.4" ? fixture34.schema : fixture.schema),
    );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockImplementation((_context, version) =>
      Promise.resolve(version === "3.4" ? fixture34.languageData : fixture.languageData),
    );
    const { ensureBundleForUri } = createBundleLoader(mockExtensionContext() as never);

    const bundle = await ensureBundleForUri(uri as never);
    expect(bundle.version).toBe("3.4");
    expect(getLoadedBundleForUri(uri as never)).toBe(bundle);
  });

  it("clears all cached bundles when invalidate is called without a version", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockImplementation((_context, version) =>
      Promise.resolve(version === "3.4" ? fixture34.schema : fixture.schema),
    );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockImplementation((_context, version) =>
      Promise.resolve(version === "3.4" ? fixture34.languageData : fixture.languageData),
    );
    const { ensureBundle, invalidate } = createBundleLoader(mockExtensionContext() as never);

    await ensureBundle("3.2");
    await ensureBundle("3.4");
    expect(getLoadedBundle("3.2")).toBeDefined();
    expect(getLoadedBundle("3.4")).toBeDefined();

    invalidate();
    expect(getLoadedBundle("3.2")).toBeUndefined();
    expect(getLoadedBundle("3.4")).toBeUndefined();
    expect(getLoadedBundle()).toBeUndefined();
  });

  it("returns undefined from getLoadedBundle when multiple versions are cached", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockImplementation((_context, version) =>
      Promise.resolve(version === "3.4" ? fixture34.schema : fixture.schema),
    );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockImplementation((_context, version) =>
      Promise.resolve(version === "3.4" ? fixture34.languageData : fixture.languageData),
    );
    const { ensureBundle } = createBundleLoader(mockExtensionContext() as never);

    await ensureBundle("3.2");
    await ensureBundle("3.4");
    expect(getLoadedBundle()).toBeUndefined();
  });

  it("wraps unexpected non-Error failures during bundle load", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockResolvedValue(fixture.schema);
    vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(fixture.languageData);
    vi.spyOn(outputChannel, "logBundleLoadSucceeded").mockImplementation(() => {
      throw new Error("post-load failure");
    });
    const { ensureBundle } = createBundleLoader(mockExtensionContext() as never);

    await expect(ensureBundle("3.2")).rejects.toThrow("post-load failure");
  });

  it("rejects stale loads from the outer async catch", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockResolvedValue(fixture.schema);
    vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(fixture.languageData);
    const { ensureBundle, invalidate } = createBundleLoader(mockExtensionContext() as never);
    vi.spyOn(outputChannel, "logBundleLoadSucceeded").mockImplementation(() => {
      invalidate("3.2");
      throw new Error("late failure");
    });

    await expect(ensureBundle("3.2")).rejects.toBeInstanceOf(BundleLoadStaleError);
  });
});
