import * as vscode from "vscode";

import {
  argumentPosition,
  getKeywordFromLanguage,
  getKeywordFromSchema,
  resolveDirective,
} from "./directiveUtils";
import { getDocumentContext } from "./documentContext";
import { HaproxyLanguageData } from "./languageData";
import { indexedKeywordNameSetForSection } from "./languageDataIndexes";
import { analyzeLine, AnalyzedLine } from "./lineAnalysis";
import { ResolvedLanguageKeyword, ResolvedSchemaKeyword } from "./keywordVariant";
import { HaproxySchema, modifierPrefixSet, noPrefixKeywordSet, sectionKeywordSet } from "./schema";

export interface LineSemanticContext {
  document: vscode.TextDocument;
  position: vscode.Position;
  schema: HaproxySchema;
  data?: HaproxyLanguageData;
  ctx: NonNullable<ReturnType<typeof getDocumentContext>>;
  allowed: ReadonlySet<string>;
  analyzed: AnalyzedLine;
  directive: ReturnType<typeof resolveDirective>;
  resolvedLanguageKeyword?: ResolvedLanguageKeyword;
  resolvedSchemaKeyword?: ResolvedSchemaKeyword;
}

export function getLineSemanticContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  data?: HaproxyLanguageData,
): LineSemanticContext | null {
  const ctx = getDocumentContext(document, position, schema);
  if (!ctx) {
    return null;
  }

  const allowed = sectionKeywordSet(schema, ctx.line.section);
  const directiveAllowed =
    data && ctx.line.section
      ? new Set(indexedKeywordNameSetForSection(data, ctx.line.section))
      : allowed;
  const analyzed = analyzeLine(ctx.line, {
    schema,
    allowed,
    noPrefix: noPrefixKeywordSet(schema),
    modifierPrefixes: modifierPrefixSet(schema),
  });
  const directive = resolveDirective(ctx.line, directiveAllowed, {
    noPrefixKeywords: noPrefixKeywordSet(schema),
    modifierPrefixes: modifierPrefixSet(schema),
  });

  const resolvedLanguageKeyword =
    data && directive.matched
      ? getKeywordFromLanguage(data, directive.keyword, ctx.line.section)
      : undefined;
  const resolvedSchemaKeyword = directive.matched
    ? getKeywordFromSchema(schema, directive.keyword, ctx.line.section)
    : undefined;

  return {
    document,
    position,
    schema,
    data,
    ctx,
    allowed,
    analyzed,
    directive,
    resolvedLanguageKeyword,
    resolvedSchemaKeyword,
  };
}

export function keywordNameSetForSection(
  data: HaproxyLanguageData,
  section: string | null,
): ReadonlySet<string> {
  return indexedKeywordNameSetForSection(data, section);
}

export function directiveArgumentPosition(semantic: LineSemanticContext): number {
  return argumentPosition(semantic.ctx.tokenIndex, semantic.directive.end);
}
