import { clearLanguageDataCache } from "./languageData";
import { clearLanguageDataIndexCache } from "./languageDataIndexes";
import { clearSchemaCache } from "./schema";

/** Clear all versioned and per-document caches after a bundle reload. */
export function invalidateAllExtensionCaches(): void {
  clearSchemaCache();
  clearLanguageDataCache();
  clearLanguageDataIndexCache();
}
