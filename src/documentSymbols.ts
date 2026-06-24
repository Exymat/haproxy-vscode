import * as vscode from "vscode";

import { getParsedDocument } from "./parseCache";
import { buildSectionSymbols } from "./sectionOutline";

export function provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const parsed = getParsedDocument(document);
  return buildSectionSymbols(parsed, document.lineCount).map((symbol) => {
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
