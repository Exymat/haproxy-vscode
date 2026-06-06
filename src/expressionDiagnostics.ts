import * as vscode from "vscode";

import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema";
import { validateAclConditions } from "./aclCondition";
import { validateSampleExpressions } from "./sampleExpression";

function mightContainExpressionSyntax(lineText: string): boolean {
  return lineText.includes("%[") || lineText.includes("{");
}

export function expressionDiagnostics(
  line: ParsedLine,
  lineText: string,
  schema: HaproxySchema,
): vscode.Diagnostic[] {
  if (!mightContainExpressionSyntax(lineText)) {
    return [];
  }
  const diagnostics: vscode.Diagnostic[] = [];
  const expressionIssues = [
    ...validateSampleExpressions(lineText, schema),
    ...validateAclConditions(lineText, schema),
  ];
  for (const issue of expressionIssues) {
    diagnostics.push(
      new vscode.Diagnostic(
        new vscode.Range(line.line, issue.start, line.line, issue.end),
        issue.message,
        vscode.DiagnosticSeverity.Error,
      ),
    );
    const last = diagnostics[diagnostics.length - 1];
    last.source = issue.source;
    last.code = issue.code;
  }
  return diagnostics;
}
