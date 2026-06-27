import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { sampleExpressionGroupForKind } from "../../domainMaps";
import { CompletionContext } from "../types";
import { filterByPrefix } from "../helpers";

export function tryExpressionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  if (cc.ctx.kind !== "expression-fetch" && cc.ctx.kind !== "expression-converter") {
    return null;
  }
  const groupName = sampleExpressionGroupForKind(cc.ctx.kind)!;
  const names = groupItems(cc.data, groupName).map((g) => g.name);
  return filterByPrefix(names, cc.partial).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
    item.detail = groupName.replace("sample_", "");
    return item;
  });
}
