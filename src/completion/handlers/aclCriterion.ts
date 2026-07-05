import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { semanticStringList } from "../../schema";
import { CompletionContext } from "../types";
import { filterByPrefix } from "../helpers";

export function tryAclCriterionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  if (cc.ctx.kind !== "acl-criterion") {
    return null;
  }
  const groups = semanticStringList(cc.schema, "acl_criterion_groups");
  const criteria = groups.flatMap((groupName) => groupItems(cc.data, groupName).map((g) => g.name));
  return filterByPrefix(criteria, cc.partial).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
    item.detail = "ACL criterion";
    return item;
  });
}
