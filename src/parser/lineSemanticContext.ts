import * as vscode from "vscode";

import {
  argumentPosition,
  getKeywordFromLanguage,
  getKeywordFromSchema,
  resolveDirective,
} from "../language/directiveUtils";
import { DocumentAnalysis, getDocumentAnalysis } from "./documentAnalysis";
import { getDocumentContext } from "./documentContext";
import { HaproxyLanguageData } from "../language/languageData";
import { indexedKeywordNameSetForSection } from "../language/languageDataIndexes";
import { AnalyzedLine } from "./lineAnalysis";
import { ResolvedLanguageKeyword, ResolvedSchemaKeyword } from "../language/keywordVariant";
import { HaproxySchema } from "../schema/types";

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
  analysis: DocumentAnalysis = getDocumentAnalysis(document, schema),
): LineSemanticContext | null {
  const ctx = getDocumentContext(document, position, schema, analysis);
  if (!ctx) {
    return null;
  }

  const lineAnalysis = analysis.getLineAnalysis(ctx.line);
  const allowed = lineAnalysis.allowed;
  const directiveAllowed =
    data && ctx.line.section
      ? new Set(indexedKeywordNameSetForSection(data, ctx.line.section))
      : allowed;
  const directive = resolveDirective(ctx.line, directiveAllowed, {
    noPrefixKeywords: analysis.noPrefix,
    modifierPrefixes: analysis.modifierPrefixes,
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
    analyzed: lineAnalysis.analyzed,
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
