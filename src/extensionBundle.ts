import * as vscode from "vscode";

import { clearLanguageDataCache, HaproxyLanguageData, loadLanguageDataAsync } from "./languageData";
import { clearSchemaCache, HaproxySchema, loadSchemaAsync } from "./schema";
import { HaproxyVersion } from "./version";

export interface ExtensionBundle {
  version: HaproxyVersion;
  schema: HaproxySchema;
  languageData: HaproxyLanguageData;
}

let bundle: ExtensionBundle | undefined;
let bundleLoadPromise: Promise<ExtensionBundle> | undefined;
let bundleLoadError: Error | undefined;
let bundleGeneration = 0;

export function invalidateBundleLoad(): void {
  bundleGeneration += 1;
  bundle = undefined;
  bundleLoadPromise = undefined;
  bundleLoadError = undefined;
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
        setImmediate(() => {
          void (async () => {
            const version = getVersion();
            const loaded = {
              version,
              schema: await loadSchemaAsync(context, version),
              languageData: await loadLanguageDataAsync(context, version),
            };
            if (isStale()) {
              return;
            }
            bundle = loaded;
            resolve(loaded);
          })().catch((error) => {
            /* c8 ignore next 3 -- stale load discarded after deactivate/reload */
            if (isStale()) {
              return;
            }
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        });
      });
      /* c8 ignore next 4 -- defensive recovery path for transient async load failures */
      bundleLoadPromise = bundleLoadPromise.catch((error) => {
        if (isStale()) {
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
    clearSchemaCache();
    clearLanguageDataCache();
    invalidateBundleLoad();
  };

  return { ensureBundle, invalidate };
}
