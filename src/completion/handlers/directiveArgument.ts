import * as vscode from "vscode";

import {
  argumentPosition,
  completionValuesForPosition,
  getKeywordFromSchema,
  resolveDirective,
} from "../../directiveUtils";
import { keywordsForSection } from "../../documentContext";
import { resolveLanguageKeyword } from "../../keywordVariant";
import { modifierPrefixSet } from "../../schema";
import { CompletionContext } from "../types";
import { filterByPrefix, markdownDoc } from "../helpers";

export function tryDirectiveArgumentCompletion(
  cc: CompletionContext,
): vscode.CompletionItem[] | null {
  if (cc.ctx.kind !== "directive-argument") {
    return null;
  }
  const sectionKeywords = keywordsForSection(cc.data, cc.ctx.line.section);
  const allowed = new Set(sectionKeywords.map((kw) => kw.name.toLowerCase()));
  const directive = resolveDirective(cc.ctx.line, allowed, {
    modifierPrefixes: modifierPrefixSet(cc.schema),
  });
  if (!directive.matched) {
    return [];
  }
  const kw = resolveLanguageKeyword(
    sectionKeywords.find((k) => k.name.toLowerCase() === directive.keyword.toLowerCase()),
    cc.ctx.line.section,
  );
  const schemaKw = getKeywordFromSchema(cc.schema, directive.keyword, cc.ctx.line.section);
  const pos = argumentPosition(cc.ctx.tokenIndex, directive.end);
  const values = completionValuesForPosition(
    schemaKw,
    kw,
    pos,
    cc.ctx.line,
    directive.end,
    directive.keyword,
  );
  const valuesByName = new Map(values.map((v) => [v.name, v]));
  return filterByPrefix(
    values.map((v) => v.name),
    cc.partial,
  ).map((name) => {
    const value = valuesByName.get(name);
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
    item.detail = kw?.name ?? "argument";
    if (value?.description) {
      item.documentation = markdownDoc(value.description, kw?.docsUrl);
    }
    return item;
  });
}
