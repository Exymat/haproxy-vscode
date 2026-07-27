/** Reports whether parse and symbol-index caches are warm for a document URI. */
import * as vscode from "vscode";

import { hasUriParseCache } from "./parseCache";
import { hasUriSymbolIndexCache } from "../symbolIndex/cache";

export function hasWarmUriDocumentCache(document: vscode.TextDocument): boolean {
  return hasUriParseCache(document) && hasUriSymbolIndexCache(document);
}
