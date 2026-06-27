import { clearLanguageDataCache } from "./languageData";
import { clearLanguageDataIndexCache } from "./languageDataIndexes";
import { configureSectionHeaders, DEFAULT_SECTION_HEADERS } from "./parser";
import { clearSchemaCache, HaproxySchema, sectionHeaderSet } from "./schema";

/** Clear all versioned and per-document caches after a bundle reload. */
export function invalidateAllExtensionCaches(): void {
  clearSchemaCache();
  clearLanguageDataCache();
  clearLanguageDataIndexCache();
  configureSectionHeaders(DEFAULT_SECTION_HEADERS);
}

export function applyLoadedSchema(schema: HaproxySchema): void {
  configureSectionHeaders(sectionHeaderSet(schema));
}
