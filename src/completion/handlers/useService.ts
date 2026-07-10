import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { semanticRecord, semanticStringMap } from "../../schema/semantic";
import { CompletionContext } from "../types";
import { filterByPrefix } from "../helpers";

function useServiceRule(schema: CompletionContext["schema"]): {
  ruleKinds: string[];
  action: string;
  serviceGroup: string;
} {
  const rule = semanticRecord(schema, "use_service");
  if (
    !Array.isArray(rule.rule_kinds) ||
    rule.rule_kinds.some((item) => typeof item !== "string") ||
    typeof rule.action !== "string" ||
    typeof rule.service_group !== "string"
  ) {
    throw new Error(
      "HAProxy schema is missing required generated metadata: semantic_groups.use_service",
    );
  }
  return {
    ruleKinds: rule.rule_kinds as string[],
    action: rule.action,
    serviceGroup: rule.service_group,
  };
}

export function tryUseServiceCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const { ctx, partial } = cc;
  const rule = useServiceRule(cc.schema);
  if (
    !rule.ruleKinds.includes(ctx.kind) ||
    ctx.tokenIndex < 2 ||
    ctx.line.tokens[1]?.text.toLowerCase() !== rule.action
  ) {
    return null;
  }
  const commonGroups = semanticStringMap(cc.schema, "common_language_groups");
  const services = groupItems(cc.data, commonGroups.services).map((g) => g.name);
  return filterByPrefix(services, partial).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
    item.detail = "service";
    return item;
  });
}
