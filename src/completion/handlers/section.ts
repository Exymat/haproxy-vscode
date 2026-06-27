import * as vscode from "vscode";

import { getSectionKeywords } from "../../documentContext";
import { CompletionContext } from "../types";

export function trySectionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  if (cc.ctx.kind !== "section" || cc.ctx.line.tokens.length !== 0) {
    return null;
  }
  return getSectionKeywords(cc.schema).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
    item.detail = "HAProxy section";
    return item;
  });
}
