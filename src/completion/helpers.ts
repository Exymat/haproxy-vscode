import * as vscode from "vscode";

import { groupItems } from "../documentContext";
import { HaproxyLanguageData, LanguageExample } from "../languageData";
import { findIndexedGroupItem } from "../languageDataIndexes";
import { languageDocMarkdown } from "../hover/markdown";
import { logFormatCompletionPrefix } from "../logFormat";
import { HaproxySchema } from "../schema/types";
import { semanticStringMap } from "../schema/semantic";

export function markdownDoc(
  description: string,
  docsUrl?: string,
  examples?: LanguageExample[],
): vscode.MarkdownString {
  return languageDocMarkdown(description, docsUrl, examples);
}

export function filterByPrefix(items: string[], prefix: string): string[] {
  const p = prefix.toLowerCase();
  if (!p) {
    return items;
  }
  return items.filter((item) => item.toLowerCase().startsWith(p));
}

export function logFormatCompletionItems(
  data: HaproxyLanguageData,
  schema: HaproxySchema,
  formatText: string,
  localOffset: number,
): vscode.CompletionItem[] {
  const prefix = logFormatCompletionPrefix(formatText, localOffset) ?? "";
  const before = formatText.slice(0, localOffset);
  const inFlags = before.lastIndexOf("{") > before.lastIndexOf("}");
  const logFormatGroups = semanticStringMap(schema, "log_format_groups");

  if (inFlags) {
    const flags = schema.tokens.logformat_flags ?? [];
    return filterByPrefix(flags, prefix).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.EnumMember);
      item.detail = "log-format flag";
      const group = findIndexedGroupItem(data, logFormatGroups.flags, name);
      if (group?.description) {
        item.documentation = markdownDoc(group.description);
      }
      return item;
    });
  }

  const aliases = groupItems(data, logFormatGroups.aliases);
  return aliases
    .filter((alias) => {
      const body = alias.name.replace(/^%/, "");
      return !prefix || body.toLowerCase().startsWith(prefix.toLowerCase());
    })
    .map((alias) => {
      const body = alias.name.replace(/^%/, "");
      const item = new vscode.CompletionItem(body, vscode.CompletionItemKind.Variable);
      item.detail = alias.name;
      item.insertText = body;
      if (alias.description) {
        item.documentation = markdownDoc(alias.description, alias.docsUrl);
      }
      return item;
    });
}
