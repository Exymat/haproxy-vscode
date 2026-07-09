import * as vscode from "vscode";

import { getLoadedBundleForUri } from "./extensionBundle";
import { getParsedDocument } from "./parseCache";
import { sectionHeaderSet } from "./schema";
import { getSectionOutline } from "./sectionOutline";

export function provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const bundle = getLoadedBundleForUri(document.uri);
  const parsed = getParsedDocument(document, {
    sectionHeaders: bundle ? sectionHeaderSet(bundle.schema) : undefined,
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
