/** Provides document symbols from the HAProxy section outline. */
import * as vscode from "vscode";

import { getLoadedBundleForUri } from "../extension/extensionBundle";
import { getParsedDocument as getParsedDocumentImpl } from "../parser/parseCache";
import { sectionHeaderSet } from "../schema/layout";
import { HaproxySchema } from "../schema/types";
import { getSectionOutline } from "./sectionOutline";

const getParsedDocument = getParsedDocumentImpl;
const DocumentSymbol = vscode.DocumentSymbol;
const Range = vscode.Range;
const SymbolKind = vscode.SymbolKind;

export function provideDocumentSymbols(
  document: vscode.TextDocument,
  schema?: HaproxySchema,
): vscode.DocumentSymbol[] {
  const effectiveSchema = schema ?? getLoadedBundleForUri(document.uri)?.schema;
  const parsed = getParsedDocument(document, {
    sectionHeaders: effectiveSchema ? sectionHeaderSet(effectiveSchema) : undefined,
  });
  return getSectionOutline(document, parsed).map((symbol) => {
    return new DocumentSymbol(
      symbol.name,
      symbol.detail,
      SymbolKind.Namespace,
      new Range(symbol.startLine, 0, symbol.endLine, symbol.endColumn),
      new Range(symbol.startLine, symbol.selectionStart, symbol.startLine, symbol.selectionEnd),
    );
  });
}
