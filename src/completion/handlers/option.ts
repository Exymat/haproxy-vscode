/** Completes option names for `option` / `no option` lines. */
import * as vscode from "vscode";

import { indexedGroupItems, indexedGroupItemsByName } from "../../language/languageDataIndexes";
import { semanticStringMap, statementRuleGroupForKind } from "../../schema/semantic";
import { resolveLanguageKeyword } from "../../language/keywordVariant";
import { CompletionContext } from "../types";
import { filterByPrefix, markdownDoc } from "../helpers";

function buildOptionCompletionItem(
  cc: CompletionContext,
  name: string,
  optionsByName: ReturnType<typeof indexedGroupItemsByName>,
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
  item.detail = "option";
  const group = optionsByName.get(name);
  const optKeyword =
    cc.data.keywords[`option ${name}`.toLowerCase()] ??
    cc.data.keywords[`no option ${name}`.toLowerCase()];
  const resolved = optKeyword ? resolveLanguageKeyword(optKeyword, cc.ctx.line.section) : undefined;
  const documentation = optionCompletionDocumentation(resolved, group);
  if (documentation) {
    item.documentation = documentation;
  }
  return item;
}

function hasOptionDocs(
  description: string | undefined,
  examples: { length: number } | undefined,
): boolean {
  return Boolean(description) || Boolean(examples?.length);
}

function optionCompletionDocumentation(
  resolved: ReturnType<typeof resolveLanguageKeyword> | undefined,
  group: ReturnType<ReturnType<typeof indexedGroupItemsByName>["get"]>,
): vscode.MarkdownString | undefined {
  if (
    !hasOptionDocs(resolved?.description, resolved?.examples) &&
    !hasOptionDocs(group?.description, group?.examples)
  ) {
    return undefined;
  }
  return markdownDoc(
    resolved?.description || group?.description || "",
    resolved?.docsUrl ?? group?.docsUrl,
    resolved?.examples ?? group?.examples,
  );
}

export function tryOptionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const optionGroup = statementRuleGroupForKind(cc.schema, cc.ctx.kind);
  const groups = semanticStringMap(cc.schema, "common_language_groups");
  if (!optionGroup || optionGroup !== groups.options) {
    return null;
  }
  const optionsByName = indexedGroupItemsByName(cc.data, groups.options);
  const options = indexedGroupItems(cc.data, groups.options).map((g) => g.name);
  return filterByPrefix(options, cc.partial).map((name) =>
    buildOptionCompletionItem(cc, name, optionsByName),
  );
}
