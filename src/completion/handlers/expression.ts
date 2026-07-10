import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { sampleExpressionGroupForKind } from "../../schema/semantic";
import { CompletionContext } from "../types";
import { filterByPrefix } from "../helpers";

export function tryExpressionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const groupName = sampleExpressionGroupForKind(cc.schema, cc.ctx.kind);
  if (!groupName) {
    return null;
  }
  const names = groupItems(cc.data, groupName).map((g) => g.name);
  return filterByPrefix(names, cc.partial).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
    item.detail = groupName.replace("sample_", "");
    return item;
  });
}
