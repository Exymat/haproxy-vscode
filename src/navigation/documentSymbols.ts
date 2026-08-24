/** Provides document symbols from the HAProxy section outline. */
import * as vscode from "vscode";

import { getLoadedBundleForUri } from "../extension/extensionBundle";
import { getParsedDocument } from "../parser/parseCache";
import { sectionHeaderSet } from "../schema/layout";
import { HaproxySchema } from "../schema/types";
import { getSectionOutline } from "./sectionOutline";

export function provideDocumentSymbols(
  document: vscode.TextDocument,
  schema?: HaproxySchema,
): vscode.DocumentSymbol[] {
  const bundle = getLoadedBundleForUri(document.uri);
  const effectiveSchema = schema ?? bundle?.schema;
  const parsed = getParsedDocument(document, {
    sectionHeaders: effectiveSchema ? sectionHeaderSet(effectiveSchema) : undefined,
  });
  return getSectionOutline(document, parsed).map((symbol) => {
    return new vscode.DocumentSymbol(
      symbol.name,
      symbol.detail,
      vscode.SymbolKind.Namespace,
      new vscode.Range(symbol.startLine, 0, symbol.endLine, symbol.endColumn),
      new vscode.Range(
        symbol.startLine,
        symbol.selectionStart,
        symbol.startLine,
        symbol.selectionEnd,
      ),
    );
  });
}
