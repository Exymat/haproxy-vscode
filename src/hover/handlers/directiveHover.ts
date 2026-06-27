import * as vscode from "vscode";

import {
  argumentPosition,
  documentedEnumValueNames,
  findArgumentValue,
  getKeywordFromLanguage,
  getKeywordFromSchema,
  resolveDirective,
} from "../../directiveUtils";
import { keywordsForSection } from "../../languageDataIndexes";
import { findKeywordByPrefix } from "../../languageData";
import { resolveLanguageKeyword } from "../../keywordVariant";
import { modifierPrefixSet } from "../../schema";
import { findGroupItem } from "../helpers";
import {
  addContextExtra,
  addSectionExtra,
  escapeMarkdownText,
  formatParameterExtra,
  hoverMarkdown,
  matchingArgumentValueNames,
  signaturesBlock,
} from "../markdown";
import { HoverContext } from "../types";

function tryArgumentValueHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, schema, range } = hc;
  const allowed = new Set(
    keywordsForSection(data, ctx.line.section).map((kw) => kw.name.toLowerCase()),
  );
  const directive = resolveDirective(ctx.line, allowed, {
    modifierPrefixes: modifierPrefixSet(schema),
  });

  if (!directive.matched || ctx.tokenIndex <= directive.end) {
    return null;
  }

  const kw = getKeywordFromLanguage(data, directive.keyword, ctx.line.section);
  const argValue = findArgumentValue(kw?.arguments, ctx.token.text);
  if (!argValue) {
    return null;
  }

  const extras: string[] = [];
  const forms = matchingArgumentValueNames(kw?.arguments, ctx.token.text);
  if (forms.length > 1) {
    extras.push("**Forms:**", signaturesBlock(forms));
  }
  if (kw) {
    extras.push(`**Directive:** ${escapeMarkdownText(kw.name)}`);
  }
  return new vscode.Hover(
    hoverMarkdown(argValue.name, "", argValue.description, extras, kw?.docsUrl),
    range,
  );
}

function tryMatchedDirectiveHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, schema } = hc;
  const allowed = new Set(
    keywordsForSection(data, ctx.line.section).map((kw) => kw.name.toLowerCase()),
  );
  const directive = resolveDirective(ctx.line, allowed, {
    modifierPrefixes: modifierPrefixSet(schema),
  });
  const kw = directive.matched
    ? getKeywordFromLanguage(data, directive.keyword, ctx.line.section)
    : undefined;
  if (!kw) {
    return null;
  }
  return buildDirectiveHover(
    hc,
    kw,
    directive,
    directive.matched && ctx.tokenIndex <= directive.end,
  );
}

function tryPrefixDirectiveHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, schema } = hc;
  const allowed = new Set(
    keywordsForSection(data, ctx.line.section).map((kw) => kw.name.toLowerCase()),
  );
  const directive = resolveDirective(ctx.line, allowed, {
    modifierPrefixes: modifierPrefixSet(schema),
  });
  const combined = ctx.line.tokens
    .slice(0, Math.min(ctx.tokenIndex + 1, 4))
    .map((t) => t.text)
    .join(" ");
  const kw = resolveLanguageKeyword(findKeywordByPrefix(data, combined), ctx.line.section);
  if (!kw) {
    return null;
  }
  return buildDirectiveHover(
    hc,
    kw,
    directive,
    directive.matched && ctx.tokenIndex <= directive.end,
  );
}

function tryGroupItemHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, range } = hc;
  const group = findGroupItem(data, ctx.token.text);
  if (!group) {
    return null;
  }
  return new vscode.Hover(
    hoverMarkdown(
      group.name,
      group.signature,
      group.description,
      [],
      group.docsUrl,
      group.examples,
    ),
    range,
  );
}

function buildDirectiveHover(
  hc: HoverContext,
  kw: NonNullable<ReturnType<typeof getKeywordFromLanguage>>,
  directive: ReturnType<typeof resolveDirective>,
  onDirectiveToken: boolean,
): vscode.Hover {
  const { ctx, schema, range } = hc;
  const extras: string[] = [];
  addSectionExtra(extras, kw.sections);
  addContextExtra(extras, getKeywordFromSchema(schema, kw.name, ctx.line.section)?.contexts);

  if (onDirectiveToken) {
    const schemaKw = getKeywordFromSchema(schema, kw.name, ctx.line.section);
    const documentedValues = documentedEnumValueNames(kw, schemaKw);
    if (documentedValues.length > 0) {
      extras.push(`**Values:** ${documentedValues.join(", ")}`);
    }
    if (kw.signatures.length > 1) {
      extras.unshift(signaturesBlock(kw.signatures));
      extras.unshift("**Forms:**");
      return new vscode.Hover(
        hoverMarkdown(kw.name, "", kw.description, extras, kw.docsUrl, kw.examples),
        range,
      );
    }
    return new vscode.Hover(
      hoverMarkdown(
        kw.name,
        kw.signatures[0] ?? kw.name,
        kw.description,
        extras,
        kw.docsUrl,
        kw.examples,
      ),
      range,
    );
  }

  const pos = argumentPosition(ctx.tokenIndex, directive.end);
  const param = kw.arguments?.[Math.min(pos, (kw.arguments?.length ?? 1) - 1)];
  if (param?.description) {
    extras.push(formatParameterExtra(param.parameter));
    extras.push(param.description);
  }

  return new vscode.Hover(
    hoverMarkdown(
      kw.name,
      kw.signatures[0] ?? kw.name,
      kw.description,
      extras,
      kw.docsUrl,
      kw.examples,
    ),
    range,
  );
}

const DIRECTIVE_HOVER_STRATEGIES: Array<(hc: HoverContext) => vscode.Hover | null> = [
  tryArgumentValueHover,
  tryMatchedDirectiveHover,
  tryPrefixDirectiveHover,
  tryGroupItemHover,
];

export function tryDirectiveHover(hc: HoverContext): vscode.Hover | null {
  for (const strategy of DIRECTIVE_HOVER_STRATEGIES) {
    const result = strategy(hc);
    if (result) {
      return result;
    }
  }
  return null;
}
