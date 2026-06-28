import { clearLanguageDataCache } from "./languageData";
import { clearLanguageDataIndexCache } from "./languageDataIndexes";
import { clearSchemaCache, HaproxySchema } from "./schema";

/** Clear all versioned and per-document caches after a bundle reload. */
export function invalidateAllExtensionCaches(): void {
  clearSchemaCache();
  clearLanguageDataCache();
  clearLanguageDataIndexCache();
}

export function applyLoadedSchema(_schema: HaproxySchema): void {
}
