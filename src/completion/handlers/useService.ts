import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { COMMON_LANGUAGE_GROUPS } from "../../domainMaps";
import { CompletionContext } from "../types";
import { filterByPrefix } from "../helpers";

export function tryUseServiceCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const { ctx, partial } = cc;
  if (
    (ctx.kind !== "http-request" &&
      ctx.kind !== "http-response" &&
      ctx.kind !== "tcp-request" &&
      ctx.kind !== "tcp-response") ||
    ctx.tokenIndex < 2 ||
    ctx.line.tokens[1]?.text.toLowerCase() !== "use-service"
  ) {
    return null;
  }
  const services = groupItems(cc.data, COMMON_LANGUAGE_GROUPS.services).map((g) => g.name);
  return filterByPrefix(services, partial).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
    item.detail = "service";
    return item;
  });
}
