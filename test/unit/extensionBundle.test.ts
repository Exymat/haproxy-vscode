import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BundleLoadStaleError,
  createBundleLoader,
  getLoadedBundle,
  invalidateBundleLoad,
} from "../../src/extensionBundle";
import * as languageData from "../../src/languageData";
import * as schema from "../../src/schema";
import { resetVscodeMock } from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";
import { loadSchemaBundle } from "../helpers/schema";

const fixture = loadSchemaBundle("3.2");

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

  it("resolves a successful load once and caches the bundle", async () => {
    const schemaSpy = vi.spyOn(schema, "loadSchemaAsync").mockResolvedValue(fixture.schema);
    const languageSpy = vi
      .spyOn(languageData, "loadLanguageDataAsync")
      .mockResolvedValue(fixture.languageData);
    const { ensureBundle } = createBundleLoader(mockExtensionContext() as never, () => "3.2");

    const first = await ensureBundle();
    const second = await ensureBundle();

    expect(first).toBe(second);
    expect(first.version).toBe("3.2");
    expect(getLoadedBundle()).toBe(first);
    expect(schemaSpy).toHaveBeenCalledTimes(1);
    expect(languageSpy).toHaveBeenCalledTimes(1);
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
    const { ensureBundle } = createBundleLoader(mockExtensionContext() as never, () => "3.2");

    const pendingA = ensureBundle();
    const pendingB = ensureBundle();
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
    const { ensureBundle, invalidate } = createBundleLoader(
      mockExtensionContext() as never,
      () => "3.2",
    );

    const pending = ensureBundle();
    await flushImmediate();
    invalidate();

    await expect(pending).rejects.toBeInstanceOf(BundleLoadStaleError);
    expect(getLoadedBundle()).toBeUndefined();

    resolveSchema(fixture.schema);
    await flushImmediate();
    expect(getLoadedBundle()).toBeUndefined();
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
    const { ensureBundle, invalidate } = createBundleLoader(
      mockExtensionContext() as never,
      () => "3.2",
    );

    const pending = ensureBundle();
    await flushImmediate();
    resolveSchema(fixture.schema);
    await flushImmediate();
    invalidate();

    await expect(pending).rejects.toBeInstanceOf(BundleLoadStaleError);

    resolveLanguage(fixture.languageData);
    await flushImmediate();
    expect(getLoadedBundle()).toBeUndefined();
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
    const { ensureBundle, invalidate } = createBundleLoader(
      mockExtensionContext() as never,
      () => "3.4",
    );

    const stale = ensureBundle();
    await flushImmediate();
    invalidate();
    await expect(stale).rejects.toBeInstanceOf(BundleLoadStaleError);

    const fresh = ensureBundle();
    await flushImmediate();
    resolveSchema(fixture.schema);
    const loaded = await fresh;

    expect(loaded.version).toBe("3.4");
    expect(schemaSpy).toHaveBeenCalledTimes(2);
    expect(getLoadedBundle()).toBe(loaded);
  });

  it("stores bundle load errors and rejects subsequent calls until invalidate", async () => {
    const schemaSpy = vi
      .spyOn(schema, "loadSchemaAsync")
      .mockRejectedValue(new Error("schema load failed"));
    vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(fixture.languageData);
    const { ensureBundle, invalidate } = createBundleLoader(
      mockExtensionContext() as never,
      () => "3.2",
    );

    await expect(ensureBundle()).rejects.toThrow("schema load failed");
    await expect(ensureBundle()).rejects.toThrow("schema load failed");
    expect(schemaSpy).toHaveBeenCalledTimes(1);
    expect(getLoadedBundle()).toBeUndefined();

    invalidate();
    schemaSpy.mockResolvedValue(fixture.schema);
    const loaded = await ensureBundle();
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
    const { ensureBundle, invalidate } = createBundleLoader(
      mockExtensionContext() as never,
      () => "3.2",
    );

    const pending = ensureBundle();
    await flushImmediate();
    invalidate();
    rejectSchema(new Error("late schema failure"));

    await expect(pending).rejects.toBeInstanceOf(BundleLoadStaleError);
    schemaSpy.mockResolvedValue(fixture.schema);
    const recovered = await ensureBundle();
    expect(recovered).toEqual(expect.objectContaining({ version: "3.2", schema: fixture.schema }));
  });
});
