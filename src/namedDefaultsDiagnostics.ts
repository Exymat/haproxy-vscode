import * as vscode from "vscode";

import { diagRangeForTokens, DIAG_SOURCE } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema/types";
import { modifierPrefixSet, namedDefaultsKeywordSet, noPrefixKeywordSet } from "./schema/tokens";
import { resolveLongestDirectiveMatch } from "./tokenUtils";

export function namedDefaultsDiagnostics(
  line: ParsedLine,
  schema: HaproxySchema,
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
  const match = resolveLongestDirectiveMatch(line, allowed, 4, noPrefix, modifierPrefixSet(schema));
  if (!match.matched || !namedDefaults.has(match.keyword.toLowerCase())) {
    return [];
  }

  const diagnostic = new vscode.Diagnostic(
    diagRangeForTokens(line, match.start, match.end),
    `'${match.keyword}' is only supported in named defaults sections, not anonymous defaults`,
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = "named-defaults-required";
  return [diagnostic];
}
