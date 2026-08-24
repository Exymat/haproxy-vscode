/** Quick fix that inserts a stub backend section for missing backend references. */
import * as vscode from "vscode";

import { DIAG_SOURCE } from "./diagnosticUtils";
import { diagnosticCodeText } from "./diagnosticSuppressions";
import { tokenizeLine } from "../parser";

const BACKEND_REFERENCE_KEYWORDS = new Set(["use_backend", "default_backend"]);

function diagnosticLine(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): number {
  return Math.max(0, Math.min(diagnostic.range.start.line, document.lineCount - 1));
}

function backendNameFromDiagnostic(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
): string | null {
  const lineNo = diagnosticLine(document, diagnostic);
  const lineText = document.lineAt(lineNo).text;
  const tokens = tokenizeLine(lineText);
  if (!BACKEND_REFERENCE_KEYWORDS.has(tokens[0]?.text.toLowerCase() ?? "")) {
    return null;
  }
  const backendToken = tokens[1];
  if (
    !backendToken ||
    diagnostic.range.start.line !== lineNo ||
    diagnostic.range.end.line !== lineNo ||
    diagnostic.range.start.character !== backendToken.start ||
    diagnostic.range.end.character !== backendToken.end
  ) {
    return null;
  }
  return backendToken.text;
}

function stubInsertionRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = Math.max(0, document.lineCount - 1);
  const lineText = document.lineAt(lastLine).text;
  if (lineText.trim().length === 0) {
    return new vscode.Range(lastLine, 0, lastLine, lineText.length);
  }
  return new vscode.Range(lastLine + 1, 0, lastLine + 1, 0);
}

function backendStubText(name: string, document: vscode.TextDocument): string {
  const prefix = document.getText().endsWith("\n") ? "" : "\n";
  return `${prefix}\nbackend ${name}\n    mode http\n    server s1 127.0.0.1:8080 check\n`;
}

export function provideMissingBackendStubCodeActions(
  document: vscode.TextDocument,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const actions: vscode.CodeAction[] = [];
  const seen = new Set<string>();

  for (const diagnostic of context.diagnostics) {
    if (diagnostic.source && diagnostic.source !== DIAG_SOURCE) {
      continue;
    }
    if (diagnosticCodeText(diagnostic.code)?.toLowerCase() !== "missing-reference") {
      continue;
    }

    const backendName = backendNameFromDiagnostic(document, diagnostic);
    if (!backendName || seen.has(backendName.toLowerCase())) {
      continue;
    }
    seen.add(backendName.toLowerCase());

    const action = new vscode.CodeAction(
      `Create backend '${backendName}' stub`,
      vscode.CodeActionKind.QuickFix,
    );
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    action.edit = new vscode.WorkspaceEdit();
    action.edit.insert(
      document.uri,
      stubInsertionRange(document).start,
      backendStubText(backendName, document),
    );
    actions.push(action);
  }

  return actions;
}
