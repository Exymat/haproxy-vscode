/** Completes HAProxy section header keywords. */
import * as vscode from "vscode";

import { sectionHeaderFromModifier } from "../../language/sectionUtils";
import { getSectionKeywords } from "../../parser/documentContext";
import { filterByPrefix } from "../helpers";
import { CompletionContext } from "../types";

const CompletionItem = vscode.CompletionItem;
const CompletionItemKind = vscode.CompletionItemKind;

export function trySectionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  if (cc.ctx.kind === "section-header-modifier") {
    return sectionHeaderModifierItems(cc);
  }
  if (cc.ctx.kind !== "section" || cc.ctx.tokenIndex !== 0) {
    return null;
  }
  const names = filterByPrefix(getSectionKeywords(cc.schema), cc.partial);
  if (names.length === 0) {
    return null;
  }
  return names.map((name) => {
    const item = new CompletionItem(name, CompletionItemKind.Module);
    item.detail = "HAProxy section";
    return item;
  });
}

function sectionHeaderModifierItems(cc: CompletionContext): vscode.CompletionItem[] {
  const modifier = sectionHeaderFromModifier(cc.schema);
  const names = filterByPrefix([modifier], cc.partial);
  return names.map((name) => {
    const item = new CompletionItem(name, CompletionItemKind.Keyword);
    item.detail = "inherit defaults profile";
    return item;
  });
}
