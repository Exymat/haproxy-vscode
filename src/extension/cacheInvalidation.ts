/** Clears all versioned and per-document caches after a bundle reload. */
import { clearCompletionHandlerCache } from "../completion/registry";
import { clearDocumentAnalysisCache } from "../parser/documentAnalysis";
import { clearParseCache } from "../parser/parseCache";
import { clearLanguageDataCache } from "../language/languageData";
import { clearLanguageDataIndexCache } from "../language/languageDataIndexes";
import { clearSchemaCache } from "../schema/load";
import { clearSymbolIndexCaches } from "../symbolIndex/cache";
import { invalidateDiscoveryCache } from "../symbolIndex/workspaceDiscovery";
import { clearDiagnosticsCache } from "../diagnostics";
import { clearRuntimeModeCache } from "../diagnostics/diagnosticContext";

/** Clear all versioned and per-document caches after a bundle reload. */
export function invalidateAllExtensionCaches(): void {
  clearSchemaCache();
  clearLanguageDataCache();
  clearLanguageDataIndexCache();
  clearSymbolIndexCaches();
  clearParseCache();
  clearDocumentAnalysisCache();
  clearDiagnosticsCache();
  clearRuntimeModeCache();
  clearCompletionHandlerCache();
  invalidateDiscoveryCache();
}
