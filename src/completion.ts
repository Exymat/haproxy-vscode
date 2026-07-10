import * as vscode from "vscode";

import { getDocumentContext } from "./documentContext";
import { HaproxyLanguageData } from "./languageData";
import { HaproxySchema } from "./schema/types";
import { runCompletionHandlers } from "./completion/registry";
import { CompletionContext } from "./completion/types";

export { groupItems, keywordsForSection } from "./languageDataIndexes";

export function provideCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
  data: HaproxyLanguageData,
  schema: HaproxySchema,
  maxSymbolLines = Number.POSITIVE_INFINITY,
): vscode.CompletionItem[] {
  const ctx = getDocumentContext(document, position, schema);
  if (!ctx) {
    return [];
  }

  const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_.-]+/);
  const partial = wordRange ? document.getText(wordRange) : "";

  const cc: CompletionContext = {
    document,
    position,
    data,
    schema,
    ctx,
    partial,
  };

  return runCompletionHandlers(cc, { maxSymbolLines });
}
