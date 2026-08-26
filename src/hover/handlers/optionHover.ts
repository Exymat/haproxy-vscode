/** Provides hover docs for option names on option lines. */
import * as vscode from "vscode";

import { getKeywordFromLanguage, getKeywordFromSchema } from "../../language/directiveUtils";
import { groupItems } from "../../parser/documentContext";
import { addContextExtra, addSectionExtra, hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

function optionKeywordForHover(hc: HoverContext) {
  return (
    getKeywordFromLanguage(hc.data, `option ${hc.ctx.token.text}`, hc.ctx.line.section) ??
    getKeywordFromLanguage(hc.data, `no option ${hc.ctx.token.text}`, hc.ctx.line.section)
  );
}

function optionHoverContexts(
  hc: HoverContext,
  optKeyword: ReturnType<typeof getKeywordFromLanguage>,
) {
  return (
    getKeywordFromSchema(
      hc.schema,
      optKeyword?.name ?? `option ${hc.tokenLower}`,
      hc.ctx.line.section,
    )?.contexts ?? hc.schema.keyword_group_contexts?.options?.[hc.tokenLower]
  );
}

function optionHoverMarkdown(
  hc: HoverContext,
  group: ReturnType<typeof groupItems>[number] | undefined,
  optKeyword: ReturnType<typeof getKeywordFromLanguage>,
) {
  const name = group?.name ?? hc.ctx.token.text;
  const extras: string[] = [];
  addSectionExtra(extras, optKeyword?.sections);
  addContextExtra(extras, optionHoverContexts(hc, optKeyword));
  return hoverMarkdown(
    `option ${name}`,
    optKeyword?.signatures[0] ?? `option ${name}`,
    optKeyword?.description || group?.description || "",
    extras,
    optKeyword?.docsUrl ?? group?.docsUrl,
    optKeyword?.examples ?? group?.examples,
  );
}

export function tryOptionHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, range, tokenLower } = hc;

  if (ctx.kind !== "option" || ctx.tokenIndex < 1) {
    return null;
  }

  const group = groupItems(data, "options").find((g) => g.name.toLowerCase() === tokenLower);
  const optKeyword = optionKeywordForHover(hc);
  if (!group && !optKeyword) {
    return null;
  }

  return new vscode.Hover(optionHoverMarkdown(hc, group, optKeyword), range);
}
