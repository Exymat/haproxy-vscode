import * as vscode from "vscode";

import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema";
import { validateSampleExpressions } from "./sampleExpression";

export function expressionDiagnostics(
  line: ParsedLine,
  lineText: string,
  schema: HaproxySchema
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  for (const issue of validateSampleExpressions(lineText, schema)) {
    diagnostics.push(
      new vscode.Diagnostic(
        new vscode.Range(line.line, issue.start, line.line, issue.end),
        issue.message,
        vscode.DiagnosticSeverity.Error
      )
    );
    const last = diagnostics[diagnostics.length - 1];
    last.source = issue.source;
    last.code = issue.code;
  }
  return diagnostics;
}
