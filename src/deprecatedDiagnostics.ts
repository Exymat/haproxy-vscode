import * as vscode from "vscode";

import { DeprecatedIndex } from "./deprecatedIndex";
import { ParsedLine } from "./parser";
import { HaproxySchema, noPrefixKeywordSet, sectionKeywordSet } from "./schema";
import {
  actionTokenIndex,
  normalizeActionName,
  resolveLongestDirectiveMatch,
} from "./tokenUtils";

export function documentUsesExposeDeprecatedDirectives(parsed: ParsedLine[]): boolean {
  for (const line of parsed) {
    if (line.section !== "global" || line.tokens.length === 0) {
      continue;
    }
    if (line.tokens[0].text.toLowerCase() === "expose-deprecated-directives") {
      return true;
    }
  }
  return false;
}

function diagRangeForTokens(line: ParsedLine, startIdx: number, endIdx: number): vscode.Range {
  const startTok = line.tokens[startIdx];
  const endTok = line.tokens[endIdx];
  return new vscode.Range(line.line, startTok.start, line.line, endTok.end);
}

export function deprecatedLineDiagnostics(
  line: ParsedLine,
  schema: HaproxySchema,
  index: DeprecatedIndex,
  allowed: Set<string>,
  noPrefix: Set<string>
): vscode.Diagnostic[] {
  const match = resolveLongestDirectiveMatch(line, allowed, 4, noPrefix);
  if (!match.matched) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const keyword = match.keyword.toLowerCase();
  if (index.keywords.has(keyword)) {
    const diagnostic = new vscode.Diagnostic(
      diagRangeForTokens(line, match.start, match.end),
      `'${match.keyword}' is deprecated in HAProxy ${schema.version}`,
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = "haproxy";
    diagnostic.code = "deprecated-keyword";
    diagnostics.push(diagnostic);
  }

  const actionIdx = actionTokenIndex(line);
  if (actionIdx === null) {
    return diagnostics;
  }

  const rawAction = line.tokens[actionIdx].text;
  const action = normalizeActionName(rawAction);
  if (!index.actions.has(action)) {
    return diagnostics;
  }

  const ruleset = line.tokens[0].text;
  const diagnostic = new vscode.Diagnostic(
    diagRange(line, actionIdx),
    `'${rawAction}' is a deprecated ${ruleset} action in HAProxy ${schema.version}`,
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = "haproxy";
  diagnostic.code = "deprecated-action";
  diagnostics.push(diagnostic);
  return diagnostics;
}

function diagRange(line: ParsedLine, tokenIndex: number): vscode.Range {
  const token = line.tokens[tokenIndex];
  return new vscode.Range(line.line, token.start, line.line, token.end);
}

export function deprecatedDiagnostics(
  parsed: ParsedLine[],
  line: ParsedLine,
  schema: HaproxySchema,
  index: DeprecatedIndex,
  suppress: boolean
): vscode.Diagnostic[] {
  if (suppress || line.tokens.length === 0 || line.isSectionHeader) {
    return [];
  }
  const allowed = sectionKeywordSet(schema, line.section);
  const noPrefix = noPrefixKeywordSet(schema);
  return deprecatedLineDiagnostics(line, schema, index, allowed, noPrefix);
}
