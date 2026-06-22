import * as vscode from "vscode";

import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema";
import {
  DelimiterDiagnostic,
  filterExpressionIssuesAgainstDelimiters,
} from "./delimiterDiagnostics";
import { validateAclConditions } from "./aclCondition";
import { validateSampleExpressions } from "./sampleExpression";

function mightContainExpressionSyntax(lineText: string): boolean {
  return lineText.includes("%[") || lineText.includes("{");
}

export function expressionDiagnostics(
  line: ParsedLine,
  lineText: string,
  schema: HaproxySchema,
  delimiterIssues: DelimiterDiagnostic[] = [],
): vscode.Diagnostic[] {
  if (!mightContainExpressionSyntax(lineText)) {
    return [];
  }
  const diagnostics: vscode.Diagnostic[] = [];
  const expressionIssues = filterExpressionIssuesAgainstDelimiters(
    [...validateSampleExpressions(lineText, schema), ...validateAclConditions(lineText, schema)],
    delimiterIssues,
  );
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
