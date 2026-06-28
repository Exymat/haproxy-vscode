import * as vscode from "vscode";

import { getKeywordFromLanguage, getKeywordFromSchema } from "../../directiveUtils";
import { groupItems } from "../../documentContext";
import { addContextExtra, addSectionExtra, hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

export function tryOptionHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, schema, range, tokenLower } = hc;

  if (ctx.kind !== "option" || ctx.tokenIndex < 1) {
    return null;
  }

  const group = groupItems(data, "options").find((g) => g.name.toLowerCase() === tokenLower);
  const optKeyword =
    getKeywordFromLanguage(data, `option ${ctx.token.text}`, ctx.line.section) ??
    getKeywordFromLanguage(data, `no option ${ctx.token.text}`, ctx.line.section);
  if (!group && !optKeyword) {
    return null;
  }

  const name = group?.name ?? ctx.token.text;
  const extras: string[] = [];
  addSectionExtra(extras, optKeyword?.sections);
  addContextExtra(
    extras,
    getKeywordFromSchema(schema, optKeyword?.name ?? `option ${tokenLower}`, ctx.line.section)
      ?.contexts ?? schema.keyword_group_contexts?.options?.[tokenLower],
  );
  /* v8 ignore start -- option hover rendering is exercised through provideHover integration */
  return new vscode.Hover(
    hoverMarkdown(
      `option ${name}`,
      optKeyword?.signatures[0] ?? `option ${name}`,
      optKeyword?.description || group?.description || "",
      extras,
      optKeyword?.docsUrl ?? group?.docsUrl,
      optKeyword?.examples ?? group?.examples,
    ),
    range,
  );
  /* v8 ignore stop */
}
