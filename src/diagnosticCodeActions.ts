import * as vscode from "vscode";

import { DIAG_SOURCE } from "./diagnosticUtils";
import { diagnosticCodeText, lineTextWithIgnoredDiagnosticCode } from "./diagnosticSuppressions";

function diagnosticLine(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): number {
  return Math.max(0, Math.min(diagnostic.range.start.line, document.lineCount - 1));
}

export function provideDiagnosticSuppressionCodeActions(
  document: vscode.TextDocument,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const actions: vscode.CodeAction[] = [];
  const seen = new Set<string>();

  for (const diagnostic of context.diagnostics) {
    if (diagnostic.source && diagnostic.source !== DIAG_SOURCE) {
      continue;
    }

    const code = diagnosticCodeText(diagnostic.code)?.toLowerCase();
    if (!code) {
      continue;
    }

    const lineNo = diagnosticLine(document, diagnostic);
    const key = `${lineNo}:${code}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const line = document.lineAt(lineNo);
    const nextText = lineTextWithIgnoredDiagnosticCode(line.text, code);
    if (nextText === null) {
      continue;
    }

    const action = new vscode.CodeAction(
      `Ignore HAProxy diagnostic '${code}' on this line`,
      vscode.CodeActionKind.QuickFix,
    );
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(
      document.uri,
      new vscode.Range(lineNo, 0, lineNo, line.text.length),
      nextText,
    );
    actions.push(action);
  }

  return actions;
}
