import * as vscode from "vscode";

import { argumentPosition, completionValuesForPosition } from "../../language/directiveUtils";
import { indexedGroupItems, indexedGroupItemsByName } from "../../language/languageDataIndexes";
import { lineOptionGroupForKind } from "../../schema/semantic";
import { resolveLineOptionSchemaKeyword } from "../../language/lineOptionKeyword";
import {
  resolveLineOptionStartIndex,
  resolveNestedLineOptionSpan,
} from "../../language/lineOptionSpan";
import { resolveLanguageKeyword } from "../../language/keywordVariant";
import { findStatementRule } from "../../formatting/statementLayout";
import { CompletionContext } from "../types";
import { filterByPrefix, markdownDoc } from "../helpers";

export function tryLineOptionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const lineOptionGroup = lineOptionGroupForKind(cc.schema, cc.ctx.kind);
  if (!lineOptionGroup) {
    return null;
  }
  const lineOptionRule = findStatementRule(cc.schema, cc.ctx.line);
  const lineOptionStart = resolveLineOptionStartIndex(cc.schema, cc.ctx.line, lineOptionRule);
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

  const optionsByName = indexedGroupItemsByName(cc.data, lineOptionGroup);
  return filterByPrefix(
    indexedGroupItems(cc.data, lineOptionGroup).map((g) => g.name),
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
