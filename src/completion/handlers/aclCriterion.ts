import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { semanticStringList, statementRuleGroupForKind } from "../../schema/semantic";
import { CompletionContext } from "../types";
import { filterByPrefix } from "../helpers";

export function tryAclCriterionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const aclGroup = statementRuleGroupForKind(cc.schema, cc.ctx.kind);
  if (!aclGroup) {
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
