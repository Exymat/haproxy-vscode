import * as vscode from "vscode";

import { keywordsForSection } from "../../parser/documentContext";
import { resolveLanguageKeyword } from "../../language/keywordVariant";
import { CompletionContext } from "../types";
import { markdownDoc } from "../helpers";

export function tryDirectiveCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const section = cc.ctx.line.section;
  const partial = cc.partial.toLowerCase();
  const existing = new Set(cc.ctx.line.tokens.map((t) => t.text.toLowerCase()));

  const items = keywordsForSection(cc.data, section)
    .filter((kw) => cc.ctx.tokenIndex === 0 && kw.name.toLowerCase().startsWith(partial))
    .map((kw) => resolveLanguageKeyword(kw, section))
    .filter((kw): kw is NonNullable<typeof kw> => Boolean(kw))
    .filter((kw) => !existing.has(kw.name.toLowerCase()) || cc.ctx.tokenIndex === 0)
    .map((kw) => {
      const item = new vscode.CompletionItem(kw.name, vscode.CompletionItemKind.Keyword);
      item.detail =
        kw.signatures.length > 1 ? `${kw.signatures.length} forms` : (kw.signatures[0] ?? kw.name);
      const sigList =
        kw.signatures.length > 1 ? kw.signatures.map((s) => `- \`${s}\``).join("\n") : "";
      const doc = sigList ? `${kw.description}\n\n${sigList}` : kw.description;
      item.documentation = markdownDoc(doc, kw.docsUrl, kw.examples);
      return item;
    });

  return items.length > 0 ? items : null;
}
