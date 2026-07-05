import * as vscode from "vscode";

import { indexedGroupItems, indexedGroupItemsByName } from "../../languageDataIndexes";
import { semanticStringMap } from "../../schema";
import { resolveLanguageKeyword } from "../../keywordVariant";
import { CompletionContext } from "../types";
import { filterByPrefix, markdownDoc } from "../helpers";

export function tryOptionCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  if (cc.ctx.kind !== "option") {
    return null;
  }
  const groups = semanticStringMap(cc.schema, "common_language_groups");
  const optionsByName = indexedGroupItemsByName(cc.data, groups.options);
  const options = indexedGroupItems(cc.data, groups.options).map((g) => g.name);
  return filterByPrefix(options, cc.partial).map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
    const group = optionsByName.get(name);
    item.detail = "option";
    const optKeyword =
      cc.data.keywords[`option ${name}`.toLowerCase()] ??
      cc.data.keywords[`no option ${name}`.toLowerCase()];
    const resolved = optKeyword
      ? resolveLanguageKeyword(optKeyword, cc.ctx.line.section)
      : undefined;
    if (
      resolved?.description ||
      group?.description ||
      resolved?.examples?.length ||
      group?.examples?.length
    ) {
      item.documentation = markdownDoc(
        resolved?.description || group?.description || "",
        resolved?.docsUrl ?? group?.docsUrl,
        resolved?.examples ?? group?.examples,
      );
    }
    return item;
  });
}
