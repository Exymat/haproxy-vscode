import * as vscode from "vscode";

import { DocumentAnalysis, getDocumentAnalysis } from "./documentAnalysis";
import { CompletionKind, EDITOR_KINDS } from "../core/editorKinds";
import { HaproxyLanguageData } from "../language/languageData";
import { isConditionalOrStatusDirective } from "../diagnostics/conditionalDirectives";
import { ParsedLine, ParsedToken } from "./index";
import { HaproxySchema } from "../schema/types";
import { sortedSectionHeaders } from "../schema/layout";
import { candidateRules, ruleMatchesLine } from "../formatting/statementLayout";
import { keywordsForSection } from "../language/languageDataIndexes";
import {
  isSectionHeaderCompletionContext,
  sectionHeaderFromProfileTokenIndex,
} from "../language/sectionUtils";
import { resolveTokenIndex } from "./tokenUtils";

export type { CompletionKind } from "../core/editorKinds";
export { EDITOR_KINDS } from "../core/editorKinds";

export interface DocumentContext {
  line: ParsedLine;
  lineText: string;
  tokenIndex: number;
  token: ParsedToken | null;
  kind: CompletionKind;
  prefix: string;
}

function linePrefixBeforeCursor(lineText: string, character: number): string {
  return lineText.slice(0, character);
}

function classifyByRules(
  schema: HaproxySchema,
  line: ParsedLine,
  tokenIndex: number,
): CompletionKind | null {
  for (const rule of candidateRules(schema, line)) {
    if (!ruleMatchesLine(rule, line.tokens)) {
      continue;
    }
    const minIdx =
      rule.minimum_token_index ??
      rule.value_token_index ??
      rule.action_token_index ??
      rule.nested_start_index ??
      rule.phase_token_index ??
      1;
    if (tokenIndex >= minIdx) {
      if (rule.kind === "directive" && rule.value_token_index !== undefined) {
        return EDITOR_KINDS.directiveArgument;
      }
      return rule.kind;
    }
  }
  return null;
}

function expressionKindAt(lineText: string, character: number): CompletionKind | null {
  const before = lineText.slice(0, character);
  const exprStart = Math.max(before.lastIndexOf("%["), before.lastIndexOf("{"));
  if (exprStart < 0) {
    return null;
  }
  const inner = before.slice(exprStart);
  if (inner.includes(":") && !inner.endsWith(":")) {
    return EDITOR_KINDS.expressionConverter;
  }
  return EDITOR_KINDS.expressionFetch;
}

export function getDocumentContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  analysis: DocumentAnalysis = getDocumentAnalysis(document, schema),
): DocumentContext | null {
  const line = analysis.parsed[position.line];
  if (!line) {
    return null;
  }

  const lineText = document.lineAt(position.line).text;
  const resolved = resolveTokenIndex(line, position.character);
  const tokenIndex = resolved.index;
  const token = resolved.token;
  const prefix = linePrefixBeforeCursor(lineText, position.character);

  if (line.isSectionHeader && tokenIndex > 0) {
    const profileIndex = sectionHeaderFromProfileTokenIndex(line, schema);
    const fromToken = profileIndex > 0 ? line.tokens[profileIndex - 1] : undefined;
    const afterFrom = fromToken !== undefined && position.character > fromToken.end;
    if (profileIndex < 0 || (tokenIndex < profileIndex && !afterFrom)) {
      return null;
    }
    return {
      line,
      lineText,
      tokenIndex,
      token,
      kind: EDITOR_KINDS.directiveArgument,
      prefix,
    };
  }

  const firstToken = line.tokens[0]?.text;
  if (isConditionalOrStatusDirective(schema, firstToken)) {
    return null;
  }

  const exprKind = expressionKindAt(lineText, position.character);
  if (exprKind) {
    return { line, lineText, tokenIndex, token, kind: exprKind, prefix };
  }

  if (isSectionHeaderCompletionContext(line, tokenIndex, lineText, position.character)) {
    return { line, lineText, tokenIndex, token, kind: EDITOR_KINDS.section, prefix };
  }

  const fromRules = classifyByRules(schema, line, tokenIndex);
  if (fromRules) {
    return { line, lineText, tokenIndex, token, kind: fromRules, prefix };
  }

  if (tokenIndex > 0) {
    return { line, lineText, tokenIndex, token, kind: EDITOR_KINDS.directiveArgument, prefix };
  }

  return { line, lineText, tokenIndex, token, kind: EDITOR_KINDS.directive, prefix };
}

export { groupItems, keywordsForSection } from "../language/languageDataIndexes";

export function sectionKeywordNames(data: HaproxyLanguageData, section: string | null): string[] {
  return keywordsForSection(data, section).map((kw) => kw.name);
}

export function getSectionKeywords(schema: HaproxySchema): string[] {
  return sortedSectionHeaders(schema);
}
