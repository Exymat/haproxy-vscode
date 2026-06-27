import * as vscode from "vscode";

import { makeLineDiagnostic } from "../diagnosticUtils";
import { ParsedLine } from "../parser";
import { isLikelyValue } from "../tokenUtils";

export const COOKIE_MODES = new Set([
  "indirect",
  "insert",
  "nocache",
  "prefix",
  "rewrite",
  "postonly",
  "preserve",
  "httponly",
  "secure",
  "domain",
  "attr",
]);

export function cookieArgumentDiagnostics(
  line: ParsedLine,
  match: { end: number },
  argIndices: number[],
  conditionals: Set<string>,
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

  for (let pos = 1; pos < argIndices.length; pos += 1) {
    const tokenIdx = argIndices[pos];
    const value = line.tokens[tokenIdx].text.toLowerCase();
    if (!COOKIE_MODES.has(value) && !isLikelyValue(value, conditionals)) {
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
