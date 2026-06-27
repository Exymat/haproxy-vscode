import * as vscode from "vscode";

import { keywordsForSection } from "../../documentContext";
import { resolveLanguageKeyword } from "../../keywordVariant";
import { CompletionContext } from "../types";
import { markdownDoc } from "../helpers";

export function tryDirectiveCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const section = cc.ctx.line.section;
  const keywords = keywordsForSection(cc.data, section)
    .map((kw) => resolveLanguageKeyword(kw, section))
    .filter((kw): kw is NonNullable<typeof kw> => Boolean(kw));
  const existing = new Set(cc.ctx.line.tokens.map((t) => t.text.toLowerCase()));

  const items = keywords
    .filter((kw) => {
      if (cc.ctx.tokenIndex === 0) {
        return kw.name.toLowerCase().startsWith(cc.partial.toLowerCase());
      }
      return false;
    })
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
