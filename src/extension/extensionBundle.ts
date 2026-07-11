import * as vscode from "vscode";

import { invalidateAllExtensionCaches } from "./cacheInvalidation";
import { HaproxyLanguageData, loadLanguageDataAsync } from "../language/languageData";
import { logBundleLoadFailed, logBundleLoadStarted, logBundleLoadSucceeded } from "./outputChannel";
import { HaproxySchema } from "../schema/types";
import { loadSchemaAsync } from "../schema/load";
import { getConfiguredVersionForUri, HaproxyVersion } from "./version";

export interface ExtensionBundle {
  version: HaproxyVersion;
  schema: HaproxySchema;
  languageData: HaproxyLanguageData;
}

export class BundleLoadStaleError extends Error {
  constructor() {
    super("Bundle load superseded");
    this.name = "BundleLoadStaleError";
  }
}

export function isBundleLoadStaleError(error: unknown): error is BundleLoadStaleError {
  return error instanceof BundleLoadStaleError;
}

interface BundleCacheEntry {
  bundle?: ExtensionBundle;
  loadPromise?: Promise<ExtensionBundle>;
  loadError?: Error;
  generation: number;
  pendingLoadReject?: (error: BundleLoadStaleError) => void;
}

const bundlesByVersion = new Map<HaproxyVersion, BundleCacheEntry>();

function getOrCreateEntry(version: HaproxyVersion): BundleCacheEntry {
  let entry = bundlesByVersion.get(version);
  if (!entry) {
    entry = { generation: 0 };
    bundlesByVersion.set(version, entry);
  }
  return entry;
}

function clearPendingLoadReject(entry: BundleCacheEntry): void {
  entry.pendingLoadReject = undefined;
}

function rejectPendingLoad(entry: BundleCacheEntry): void {
  if (entry.pendingLoadReject) {
    const reject = entry.pendingLoadReject;
    clearPendingLoadReject(entry);
    reject(new BundleLoadStaleError());
  }
}

export function invalidateBundleLoad(version?: HaproxyVersion): void {
  invalidateAllExtensionCaches();

  if (version) {
    const entry = bundlesByVersion.get(version);
    if (entry) {
      entry.generation += 1;
      entry.bundle = undefined;
      entry.loadPromise = undefined;
      entry.loadError = undefined;
      rejectPendingLoad(entry);
    }
    return;
  }

  bundlesByVersion.clear();
}

export function getLoadedBundle(version?: HaproxyVersion): ExtensionBundle | undefined {
  if (version) {
    return bundlesByVersion.get(version)?.bundle;
  }
  const loaded = [...bundlesByVersion.values()].map((entry) => entry.bundle).filter(Boolean);
  return loaded.length === 1 ? loaded[0] : undefined;
}

export function getLoadedBundleForUri(uri?: vscode.Uri): ExtensionBundle | undefined {
  return getLoadedBundle(getConfiguredVersionForUri(uri));
}

export function createBundleLoader(context: vscode.ExtensionContext): {
  ensureBundle: (version: HaproxyVersion) => Promise<ExtensionBundle>;
  ensureBundleForUri: (uri?: vscode.Uri) => Promise<ExtensionBundle>;
  invalidate: (version?: HaproxyVersion) => void;
} {
  const ensureBundle = (version: HaproxyVersion): Promise<ExtensionBundle> => {
    const entry = getOrCreateEntry(version);
    if (entry.bundle) {
      return Promise.resolve(entry.bundle);
    }
    if (entry.loadError) {
      return Promise.reject(entry.loadError);
    }
    if (!entry.loadPromise) {
      const generation = entry.generation;
      const isStale = (): boolean => generation !== entry.generation;
      entry.loadPromise = new Promise((resolve, reject) => {
        entry.pendingLoadReject = reject;
        const rejectLoad = (error: Error): void => {
          clearPendingLoadReject(entry);
          reject(error);
        };
        const resolveLoad = (value: ExtensionBundle): void => {
          clearPendingLoadReject(entry);
          resolve(value);
        };
        setImmediate(() => {
          void (async () => {
            logBundleLoadStarted(version);
            let schemaError: Error | undefined;
            let languageError: Error | undefined;
            let loadedSchema: HaproxySchema | undefined;
            let loadedLanguageData: HaproxyLanguageData | undefined;
            try {
              loadedSchema = await loadSchemaAsync(context, version);
            } catch (error) {
              schemaError = error instanceof Error ? error : new Error(String(error));
            }
            try {
              loadedLanguageData = await loadLanguageDataAsync(context, version);
            } catch (error) {
              languageError = error instanceof Error ? error : new Error(String(error));
            }
            if (schemaError) {
              logBundleLoadFailed(version, schemaError.message, "schema");
            }
            if (languageError) {
              logBundleLoadFailed(version, languageError.message, "language-data");
            }
            if (schemaError || languageError) {
              rejectLoad(schemaError ?? languageError!);
              return;
            }
            const loaded = {
              version,
              schema: loadedSchema!,
              languageData: loadedLanguageData!,
            };
            if (isStale()) {
              rejectLoad(new BundleLoadStaleError());
              return;
            }
            entry.bundle = loaded;
            logBundleLoadSucceeded(version);
            resolveLoad(loaded);
          })().catch((error) => {
            if (isStale()) {
              rejectLoad(new BundleLoadStaleError());
              return;
            }
            rejectLoad(error instanceof Error ? error : new Error(String(error)));
          });
        });
      });
      entry.loadPromise = entry.loadPromise.catch((error) => {
        if (isStale() || isBundleLoadStaleError(error)) {
          throw error;
        }
        entry.loadPromise = undefined;
        entry.loadError = error instanceof Error ? error : new Error(String(error));
        throw entry.loadError;
      });
    }
    return entry.loadPromise;
  };

  const ensureBundleForUri = (uri?: vscode.Uri): Promise<ExtensionBundle> =>
    ensureBundle(getConfiguredVersionForUri(uri));

  const invalidate = (version?: HaproxyVersion): void => {
    invalidateBundleLoad(version);
  };

  return { ensureBundle, ensureBundleForUri, invalidate };
}
