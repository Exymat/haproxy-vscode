import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { semanticStringMap } from "../../schema";
import { CompletionContext } from "../types";
import { filterByPrefix } from "../helpers";

export function tryFilterCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  if (cc.ctx.kind !== "filter") {
    return null;
  }
  const groups = semanticStringMap(cc.schema, "common_language_groups");
  const filters = groupItems(cc.data, groups.filters).map((g) => g.name);
  return filterByPrefix(filters, cc.partial).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
    item.detail = "filter";
    return item;
  });
}
