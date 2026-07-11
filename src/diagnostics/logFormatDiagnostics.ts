import * as vscode from "vscode";

import { LogFormatLineMemo, validateLogFormatLine } from "../language/logFormat";
import { ParsedLine } from "../parser";
import { HaproxySchema } from "../schema/types";

export function logFormatDiagnostics(
  line: ParsedLine,
  lineText: string,
  schema: HaproxySchema,
  memo?: LogFormatLineMemo,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  for (const issue of validateLogFormatLine(lineText, line.tokens, schema, memo?.regions)) {
    diagnostics.push(
      new vscode.Diagnostic(
        new vscode.Range(line.line, issue.start, line.line, issue.end),
        issue.message,
        vscode.DiagnosticSeverity.Error,
      ),
    );
    const last = diagnostics[diagnostics.length - 1];
    last.source = "haproxy";
    last.code = issue.code;
  }
  return diagnostics;
}
