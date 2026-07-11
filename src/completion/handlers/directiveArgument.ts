import * as vscode from "vscode";

import { completionValuesForPosition } from "../../language/directiveUtils";
import {
  directiveArgumentPosition,
  getLineSemanticContext,
} from "../../parser/lineSemanticContext";
import { CompletionContext } from "../types";
import { filterByPrefix, markdownDoc } from "../helpers";

export function tryDirectiveArgumentCompletion(
  cc: CompletionContext,
): vscode.CompletionItem[] | null {
  if (cc.ctx.kind !== "directive-argument") {
    return null;
  }
  const semantic = getLineSemanticContext(cc.document, cc.position, cc.schema, cc.data);
  if (!semantic) {
    return [];
  }
  const directive = semantic.directive;
  if (!directive.matched) {
    return [];
  }
  const kw = semantic.resolvedLanguageKeyword;
  const schemaKw = semantic.resolvedSchemaKeyword;
  const pos = directiveArgumentPosition(semantic);
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
