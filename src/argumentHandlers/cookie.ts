import * as vscode from "vscode";

import { makeLineDiagnostic } from "../diagnosticUtils";
import { ParsedLine } from "../parser";
import { HaproxySchema, validationRecord } from "../schema";
import { isLikelyValue } from "../tokenUtils";

export function cookieArgumentDiagnostics(
  line: ParsedLine,
  match: { end: number },
  argIndices: number[],
  conditionals: Set<string>,
  schema: HaproxySchema,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  if (argIndices.length === 0) {
    diagnostics.push(
      makeLineDiagnostic(
        line,
        match.end,
        "'cookie' expects a cookie name",
        "missing-argument",
        vscode.DiagnosticSeverity.Error,
      ),
    );
    return diagnostics;
  }

  const specialRules = validationRecord(schema, "special_argument_rules");
  const cookieRule =
    specialRules.cookie && typeof specialRules.cookie === "object"
      ? (specialRules.cookie as Record<string, unknown>)
      : undefined;
  if (!cookieRule || !Array.isArray(cookieRule.modes)) {
    throw new Error(
      "HAProxy schema is missing required generated metadata: validation_rules.special_argument_rules.cookie.modes",
    );
  }
  const modes = new Set(
    cookieRule.modes.filter((mode): mode is string => typeof mode === "string"),
  );

  for (let pos = 1; pos < argIndices.length; pos += 1) {
    const tokenIdx = argIndices[pos];
    const value = line.tokens[tokenIdx].text.toLowerCase();
    if (!modes.has(value) && !isLikelyValue(value, conditionals)) {
      diagnostics.push(
        makeLineDiagnostic(
          line,
          tokenIdx,
          `Unknown cookie modifier '${line.tokens[tokenIdx].text}'`,
          "unknown-value",
        ),
      );
    }
  }
  return diagnostics;
}
