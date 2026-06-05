import * as vscode from "vscode";

import { ParsedLine } from "./parser";
import { HaproxySchema, namedDefaultsKeywordSet, noPrefixKeywordSet } from "./schema";
import { resolveLongestDirectiveMatch } from "./tokenUtils";

function diagRangeForTokens(line: ParsedLine, startIdx: number, endIdx: number): vscode.Range {
  const startTok = line.tokens[startIdx];
  const endTok = line.tokens[endIdx];
  return new vscode.Range(line.line, startTok.start, line.line, endTok.end);
}

export function namedDefaultsDiagnostics(
  line: ParsedLine,
  schema: HaproxySchema
): vscode.Diagnostic[] {
  if (
    line.tokens.length === 0 ||
    line.isSectionHeader ||
    !line.anonymousDefaults ||
    line.section !== "defaults"
  ) {
    return [];
  }

  const namedDefaults = namedDefaultsKeywordSet(schema);
  if (namedDefaults.size === 0) {
    return [];
  }

  const allowed = new Set([...namedDefaults]);
  const noPrefix = noPrefixKeywordSet(schema);
  const match = resolveLongestDirectiveMatch(line, allowed, 4, noPrefix);
  if (!match.matched || !namedDefaults.has(match.keyword.toLowerCase())) {
    return [];
  }

  const diagnostic = new vscode.Diagnostic(
    diagRangeForTokens(line, match.start, match.end),
    `'${match.keyword}' is only supported in named defaults sections, not anonymous defaults`,
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = "haproxy";
  diagnostic.code = "named-defaults-required";
  return [diagnostic];
}
