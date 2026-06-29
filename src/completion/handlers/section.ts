import * as vscode from "vscode";

import { getSectionKeywords } from "../../documentContext";
import { filterByPrefix } from "../helpers";
import { CompletionContext } from "../types";

export function trySectionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  if (cc.ctx.kind !== "section" || cc.ctx.tokenIndex !== 0) {
    return null;
  }
  const names = filterByPrefix(getSectionKeywords(cc.schema), cc.partial);
  if (names.length === 0) {
    return null;
  }
  return names.map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
    item.detail = "HAProxy section";
    return item;
  });
}
