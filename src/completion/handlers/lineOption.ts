import * as vscode from "vscode";

import { argumentPosition, completionValuesForPosition } from "../../directiveUtils";
import { groupItems } from "../../documentContext";
import { lineOptionGroupForKind } from "../../domainMaps";
import {
  resolveLineOptionSchemaKeyword,
  resolveLineOptionStartIndex,
  resolveNestedLineOptionSpan,
} from "../../hover/lineOptions";
import { resolveLanguageKeyword } from "../../keywordVariant";
import { findStatementRule } from "../../statementLayout";
import { CompletionContext } from "../types";
import { filterByPrefix, markdownDoc } from "../helpers";

export function tryLineOptionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  if (cc.ctx.kind !== "bind" && cc.ctx.kind !== "server") {
    return null;
  }
  const lineOptionGroup = lineOptionGroupForKind(cc.ctx.kind)!;
  const lineOptionRule = findStatementRule(cc.schema, cc.ctx.line);
  const lineOptionStart = resolveLineOptionStartIndex(cc.ctx.line, lineOptionRule);
  if (lineOptionStart < 0 || cc.ctx.tokenIndex < lineOptionStart) {
    return [];
  }

  const active = resolveNestedLineOptionSpan(cc.schema, cc.ctx, lineOptionGroup, lineOptionStart);
  if (active && cc.ctx.tokenIndex > active.optionIndex) {
    const schemaKw = resolveLineOptionSchemaKeyword(
      cc.schema,
      active.keyword,
      cc.ctx.kind,
      cc.ctx.line.section,
    );
    const langKw = resolveLanguageKeyword(cc.data.keywords[active.keyword], cc.ctx.line.section);
    const pos = argumentPosition(cc.ctx.tokenIndex, active.optionIndex);
    const values = completionValuesForPosition(
      schemaKw,
      langKw,
      pos,
      cc.ctx.line,
      active.optionIndex,
      active.keyword,
    );
    const valuesByName = new Map(values.map((v) => [v.name, v]));
    return filterByPrefix(
      values.map((v) => v.name),
      cc.partial,
    ).map((name) => {
      const value = valuesByName.get(name);
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
      item.detail = active.keyword;
      if (value?.description) {
        item.documentation = markdownDoc(value.description);
      }
      return item;
    });
  }

  const optionItems = groupItems(cc.data, lineOptionGroup);
  const optionsByName = new Map(optionItems.map((g) => [g.name, g]));
  return filterByPrefix(
    optionItems.map((g) => g.name),
    cc.partial,
  ).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
    const group = optionsByName.get(name);
    item.detail = cc.ctx.kind;
    if (group?.description || group?.examples?.length) {
      item.documentation = markdownDoc(group.description, group.docsUrl, group.examples);
    }
    return item;
  });
}
