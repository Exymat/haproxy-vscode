/** Clears all versioned and per-document caches after a bundle reload. */
import { clearCompletionHandlerCache } from "../completion/registry";
import { clearLanguageDataCache } from "../language/languageData";
import { clearLanguageDataIndexCache } from "../language/languageDataIndexes";
import { clearSchemaCache } from "../schema/load";
import { invalidateDiscoveryCache } from "../symbolIndex/workspaceDiscovery";
import { clearDiagnosticsCache } from "../diagnostics";
import { clearDocumentSessions } from "../document/sessionStore";

/** Clear all versioned and per-document caches after a bundle reload. */
export function invalidateAllExtensionCaches(): void {
  clearSchemaCache();
  clearLanguageDataCache();
  clearLanguageDataIndexCache();
  clearDocumentSessions();
  clearDiagnosticsCache();
  clearCompletionHandlerCache();
  invalidateDiscoveryCache();
}
