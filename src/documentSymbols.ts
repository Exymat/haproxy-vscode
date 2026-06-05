import * as vscode from "vscode";

import { getParsedDocument } from "./parseCache";
import { buildSectionSymbols } from "./sectionOutline";

export function provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const parsed = getParsedDocument(document);
  return buildSectionSymbols(parsed, document.lineCount).map((symbol) => {
    const endLineText = document.lineAt(symbol.endLine).text;
    return new vscode.DocumentSymbol(
      symbol.name,
      symbol.detail,
      vscode.SymbolKind.Namespace,
      new vscode.Range(symbol.startLine, 0, symbol.endLine, endLineText.length),
      new vscode.Range(symbol.startLine, symbol.selectionStart, symbol.startLine, symbol.selectionEnd)
    );
  });
}
