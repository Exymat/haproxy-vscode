import * as vscode from "vscode";

import { applyLoadedSchema, invalidateAllExtensionCaches } from "./cacheInvalidation";
import { HaproxyLanguageData, loadLanguageDataAsync } from "./languageData";
import { HaproxySchema, loadSchemaAsync } from "./schema";
import { HaproxyVersion } from "./version";

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

let bundle: ExtensionBundle | undefined;
let bundleLoadPromise: Promise<ExtensionBundle> | undefined;
let bundleLoadError: Error | undefined;
let bundleGeneration = 0;
let pendingLoadReject: ((error: BundleLoadStaleError) => void) | undefined;

function clearPendingLoadReject(): void {
  pendingLoadReject = undefined;
}

function rejectPendingLoad(): void {
  if (pendingLoadReject) {
    const reject = pendingLoadReject;
    clearPendingLoadReject();
    reject(new BundleLoadStaleError());
  }
}

export function invalidateBundleLoad(): void {
  bundleGeneration += 1;
  bundle = undefined;
  bundleLoadPromise = undefined;
  bundleLoadError = undefined;
  rejectPendingLoad();
}

export function getLoadedBundle(): ExtensionBundle | undefined {
  return bundle;
}

export function createBundleLoader(
  context: vscode.ExtensionContext,
  getVersion: () => HaproxyVersion,
): {
  ensureBundle: () => Promise<ExtensionBundle>;
  invalidate: () => void;
} {
  const ensureBundle = (): Promise<ExtensionBundle> => {
    if (bundle) {
      return Promise.resolve(bundle);
    }
    if (bundleLoadError) {
      return Promise.reject(bundleLoadError);
    }
    if (!bundleLoadPromise) {
      const generation = bundleGeneration;
      const isStale = (): boolean => generation !== bundleGeneration;
      bundleLoadPromise = new Promise((resolve, reject) => {
        pendingLoadReject = reject;
        const rejectLoad = (error: Error): void => {
          clearPendingLoadReject();
          reject(error);
        };
        const resolveLoad = (value: ExtensionBundle): void => {
          clearPendingLoadReject();
          resolve(value);
        };
        setImmediate(() => {
          void (async () => {
            const version = getVersion();
            const loaded = {
              version,
              schema: await loadSchemaAsync(context, version),
              languageData: await loadLanguageDataAsync(context, version),
            };
            if (isStale()) {
              rejectLoad(new BundleLoadStaleError());
              return;
            }
            bundle = loaded;
            applyLoadedSchema(loaded.schema);
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
      bundleLoadPromise = bundleLoadPromise.catch((error) => {
        if (isStale() || isBundleLoadStaleError(error)) {
          throw error;
        }
        bundleLoadPromise = undefined;
        bundleLoadError = error instanceof Error ? error : new Error(String(error));
        throw bundleLoadError;
      });
    }
    return bundleLoadPromise;
  };

  const invalidate = (): void => {
    invalidateAllExtensionCaches();
    invalidateBundleLoad();
  };

  return { ensureBundle, invalidate };
}
