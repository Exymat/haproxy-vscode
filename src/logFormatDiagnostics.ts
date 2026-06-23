import * as vscode from "vscode";

import { validateLogFormatLine } from "./logFormat";
import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema";

export function logFormatDiagnostics(
  line: ParsedLine,
  lineText: string,
  schema: HaproxySchema,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  for (const issue of validateLogFormatLine(lineText, line.tokens, schema)) {
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
