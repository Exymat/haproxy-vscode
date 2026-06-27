import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { actionGroupForCompletionKind } from "../../domainMaps";
import { CompletionContext } from "../types";
import { filterByPrefix, markdownDoc } from "../helpers";

export function tryActionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const actionKind = actionGroupForCompletionKind(cc.ctx.kind);
  if (!actionKind) {
    return null;
  }
  const actionItems = groupItems(cc.data, actionKind);
  const actionsByName = new Map(actionItems.map((g) => [g.name, g]));
  const actions = actionItems.map((g) => g.name);
  return filterByPrefix(actions, cc.partial).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
    const group = actionsByName.get(name);
    item.detail = cc.ctx.kind;
    if (group?.description || group?.examples?.length) {
      item.documentation = markdownDoc(group.description, group.docsUrl, group.examples);
    }
    return item;
  });
}
