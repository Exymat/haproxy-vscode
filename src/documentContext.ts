import * as vscode from "vscode";

import { DocumentAnalysis, getDocumentAnalysis } from "./documentAnalysis";
import { HaproxyLanguageData } from "./languageData";
import { isConditionalOrStatusDirective } from "./conditionalDirectives";
import { ParsedLine, ParsedToken } from "./parser";
import { HaproxySchema, sortedSectionHeaders } from "./schema";
import { candidateRules, ruleMatchesLine } from "./statementLayout";
import { keywordsForSection } from "./languageDataIndexes";
import { isSectionHeaderCompletionContext } from "./sectionUtils";
import { resolveTokenIndex } from "./tokenUtils";

export type CompletionKind =
  | "section"
  | "directive"
  | "directive-argument"
  | "option"
  | "bind"
  | "server"
  | "http-request"
  | "http-response"
  | "http-after-response"
  | "tcp-request"
  | "tcp-response"
  | "acl-criterion"
  | "filter"
  | "expression-fetch"
  | "expression-converter";

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
        return "directive-argument";
      }
      return rule.kind as CompletionKind;
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
    return "expression-converter";
  }
  return "expression-fetch";
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
    const fromIndex = line.tokens.findIndex(
      (tok, index) => index >= 2 && tok.text.toLowerCase() === "from",
    );
    if (fromIndex < 0 || tokenIndex < fromIndex + 1) {
      return null;
    }
    return { line, lineText, tokenIndex, token, kind: "directive-argument", prefix };
  }

  const firstToken = line.tokens[0]?.text;
  if (isConditionalOrStatusDirective(firstToken)) {
    return null;
  }

  const exprKind = expressionKindAt(lineText, position.character);
  if (exprKind) {
    return { line, lineText, tokenIndex, token, kind: exprKind, prefix };
  }

  if (isSectionHeaderCompletionContext(line, tokenIndex, lineText, position.character)) {
    return { line, lineText, tokenIndex, token, kind: "section", prefix };
  }

  const fromRules = classifyByRules(schema, line, tokenIndex);
  if (fromRules) {
    return { line, lineText, tokenIndex, token, kind: fromRules, prefix };
  }

  if (tokenIndex > 0) {
    return { line, lineText, tokenIndex, token, kind: "directive-argument", prefix };
  }

  return { line, lineText, tokenIndex, token, kind: "directive", prefix };
}

export { groupItems, keywordsForSection } from "./languageDataIndexes";

export function sectionKeywordNames(data: HaproxyLanguageData, section: string | null): string[] {
  return keywordsForSection(data, section).map((kw) => kw.name);
}

export function getSectionKeywords(schema: HaproxySchema): string[] {
  return sortedSectionHeaders(schema);
}
