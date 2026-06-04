import * as vscode from "vscode";

import { HaproxyLanguageData, LanguageKeyword } from "./languageData";
import { isConditionalOrStatusDirective } from "./conditionalDirectives";
import { getParsedDocument } from "./parseCache";
import { ParsedLine, ParsedToken } from "./parser";
import { HaproxySchema, sectionNames, StatementRule } from "./schema";

export type CompletionKind =
  | "section"
  | "directive"
  | "directive-argument"
  | "option"
  | "http-request"
  | "http-response"
  | "http-after-response"
  | "tcp-request"
  | "tcp-response"
  | "acl-criterion"
  | "filter"
  | "expression-fetch"
  | "expression-converter"
  | "none";

export interface DocumentContext {
  line: ParsedLine;
  lineText: string;
  tokenIndex: number;
  token: ParsedToken | null;
  kind: CompletionKind;
  prefix: string;
}

function tokenAtPosition(line: ParsedLine, character: number): { index: number; token: ParsedToken } | null {
  for (let i = 0; i < line.tokens.length; i += 1) {
    const tok = line.tokens[i];
    if (character >= tok.start && character <= tok.end) {
      return { index: i, token: tok };
    }
  }
  return null;
}

function linePrefixBeforeCursor(lineText: string, character: number): string {
  return lineText.slice(0, character);
}

function ruleMatchesLine(rule: StatementRule, tokens: ParsedToken[]): boolean {
  if (tokens.length === 0) {
    return false;
  }
  const t0 = tokens[0].text.toLowerCase();
  if (rule.prefix) {
    const parts = rule.prefix.split(/\s+/);
    if (parts.length === 1) {
      return t0 === parts[0] && tokens[1]?.text.toLowerCase() === rule.keyword;
    }
    return false;
  }
  return t0 === rule.keyword;
}

function classifyByRules(
  rules: StatementRule[],
  line: ParsedLine,
  tokenIndex: number
): CompletionKind | null {
  for (const rule of rules) {
    if (!ruleMatchesLine(rule, line.tokens)) {
      continue;
    }
    const minIdx =
      rule.value_token_index ??
      rule.action_token_index ??
      rule.nested_start_index ??
      rule.phase_token_index ??
      1;
    if (tokenIndex >= minIdx) {
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
  schema: HaproxySchema
): DocumentContext | null {
  const parsed = getParsedDocument(document);
  const line = parsed[position.line];
  if (!line || line.isSectionHeader) {
    return null;
  }

  const firstToken = line.tokens[0]?.text;
  if (isConditionalOrStatusDirective(firstToken)) {
    return null;
  }

  const lineText = document.lineAt(position.line).text;
  const hit = tokenAtPosition(line, position.character);
  const tokenIndex = hit?.index ?? Math.max(0, line.tokens.length - 1);
  const token = hit?.token ?? line.tokens[tokenIndex] ?? null;
  const prefix = linePrefixBeforeCursor(lineText, position.character);

  const exprKind = expressionKindAt(lineText, position.character);
  if (exprKind) {
    return { line, lineText, tokenIndex, token, kind: exprKind, prefix };
  }

  if (line.tokens.length === 0) {
    const trimmed = lineText.trim();
    if (!trimmed) {
      return { line, lineText, tokenIndex: 0, token: null, kind: "section", prefix: "" };
    }
  }

  const fromRules = classifyByRules(schema.statement_rules ?? [], line, tokenIndex);
  if (fromRules) {
    return { line, lineText, tokenIndex, token, kind: fromRules, prefix };
  }

  if (tokenIndex > 0) {
    return { line, lineText, tokenIndex, token, kind: "directive-argument", prefix };
  }

  return { line, lineText, tokenIndex, token, kind: "directive", prefix };
}

export function keywordsForSection(data: HaproxyLanguageData, section: string | null): LanguageKeyword[] {
  if (!section) {
    return [];
  }
  return Object.values(data.keywords).filter((kw) => kw.sections.includes(section));
}

export function groupItems(
  data: HaproxyLanguageData,
  groupName: string
): HaproxyLanguageData["groups"][string] {
  return data.groups[groupName] ?? [];
}

export function sectionKeywordNames(data: HaproxyLanguageData, section: string | null): string[] {
  return keywordsForSection(data, section).map((kw) => kw.name);
}

export function getSectionKeywords(schema: HaproxySchema): string[] {
  return sectionNames(schema);
}
