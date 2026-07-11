import { clearLanguageDataCache } from "../language/languageData";
import { clearLanguageDataIndexCache } from "../language/languageDataIndexes";
import { clearSchemaCache } from "../schema/load";
import { clearSymbolIndexCaches } from "../symbolIndex/cache";

/** Clear all versioned and per-document caches after a bundle reload. */
export function invalidateAllExtensionCaches(): void {
  clearSchemaCache();
  clearLanguageDataCache();
  clearLanguageDataIndexCache();
  clearSymbolIndexCaches();
}
