import * as vscode from "vscode";

import { getParsedDocument } from "./parseCache";
import { getSectionOutline } from "./sectionOutline";

export function provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const parsed = getParsedDocument(document);
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
