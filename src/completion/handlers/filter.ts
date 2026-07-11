import * as vscode from "vscode";

import { groupItems } from "../../parser/documentContext";
import { semanticStringMap, statementRuleGroupForKind } from "../../schema/semantic";
import { CompletionContext } from "../types";
import { filterByPrefix } from "../helpers";

export function tryFilterCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const filterGroup = statementRuleGroupForKind(cc.schema, cc.ctx.kind);
  const groups = semanticStringMap(cc.schema, "common_language_groups");
  if (!filterGroup || filterGroup !== groups.filters) {
    return null;
  }
  const filters = groupItems(cc.data, groups.filters).map((g) => g.name);
  return filterByPrefix(filters, cc.partial).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
    item.detail = "filter";
    return item;
  });
}
