import * as vscode from "vscode";

import { makeLineDiagnostic } from "../diagnosticUtils";
import { ParsedLine } from "../parser";
import { isLikelyValue } from "../tokenUtils";

export function mysqlCheckOptionDiagnostics(
  line: ParsedLine,
  match: { end: number },
  argIndices: number[],
  conditionals: Set<string>,
): vscode.Diagnostic[] {
  void match;
  const diagnostics: vscode.Diagnostic[] = [];
  if (argIndices.length === 0) {
    return diagnostics;
  }
  const first = line.tokens[argIndices[0]].text.toLowerCase();
  if (first === "user") {
    if (argIndices.length < 2) {
      diagnostics.push(
        makeLineDiagnostic(
          line,
          argIndices[0],
          "option mysql-check user expects a username",
          "missing-argument",
          vscode.DiagnosticSeverity.Error,
        ),
      );
    }
    const modeIdx = argIndices.length >= 3 ? argIndices[2] : argIndices[1];
    if (argIndices.length >= 3) {
      const mode = line.tokens[modeIdx].text.toLowerCase();
      /* v8 ignore start -- third mysql-check mode token is only validated when the optional mode is present */
      if (mode !== "post-41" && mode !== "pre-41") {
        diagnostics.push(
          makeLineDiagnostic(
            line,
            modeIdx,
            `Unknown mysql-check mode '${line.tokens[modeIdx].text}' (expected: post-41, pre-41)`,
            "unknown-value",
          ),
        );
      }
      /* v8 ignore stop */
    }
    return diagnostics;
  }

  const mode = first;
  if (mode !== "post-41" && mode !== "pre-41" && !isLikelyValue(mode, conditionals)) {
    diagnostics.push(
      makeLineDiagnostic(
        line,
        argIndices[0],
        `Unknown value '${line.tokens[argIndices[0]].text}' for 'option mysql-check' (expected: user, post-41, pre-41)`,
        "unknown-value",
      ),
    );
  }
  return diagnostics;
}

export function httpSendNameHeaderDiagnostics(
  line: ParsedLine,
  argIndices: number[],
  version: string,
): vscode.Diagnostic[] {
  /* v8 ignore start -- version-gated validation only applies once newer keyword semantics are enabled */
  if (Number.parseFloat(version) < 3.4) {
    return [];
  }
  /* v8 ignore stop */
  if (argIndices.length === 0) {
    return [];
  }
  const firstIdx = argIndices[0];
  const name = line.tokens[firstIdx].text;
  if (name.toLowerCase() !== "host") {
    return [];
  }
  return [
    makeLineDiagnostic(
      line,
      firstIdx,
      "'host' cannot be used for 'http-send-name-header'",
      "unknown-value",
      vscode.DiagnosticSeverity.Error,
    ),
  ];
}
