import * as vscode from "vscode";

import { ParsedLine } from "../parser";

export const DIAG_SOURCE = "haproxy";

export function diagRangeForTokens(
  line: ParsedLine,
  startIdx: number,
  endIdx: number,
): vscode.Range {
  const startTok = line.tokens[startIdx];
  const endTok = line.tokens[endIdx];
  return new vscode.Range(line.line, startTok.start, line.line, endTok.end);
}

export function diagRange(line: ParsedLine, tokenIndex: number): vscode.Range {
  return diagRangeForTokens(line, tokenIndex, tokenIndex);
}

export function diagRangeForMatch(
  line: ParsedLine,
  tokenIndex: number,
  startOffset: number,
  length: number,
): vscode.Range {
  const token = line.tokens[tokenIndex];
  return new vscode.Range(
    line.line,
    token.start + startOffset,
    line.line,
    token.start + startOffset + length,
  );
}

export function makeDiagnostic(
  range: vscode.Range,
  message: string,
  severity: vscode.DiagnosticSeverity,
  code: string,
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = code;
  return diagnostic;
}

export function makeLineDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  message: string,
  code: string,
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Warning,
): vscode.Diagnostic {
  return makeDiagnostic(diagRange(line, tokenIndex), message, severity, code);
}

export function makeError(
  line: ParsedLine,
  tokenIndex: number,
  message: string,
  code: string,
): vscode.Diagnostic {
  return makeLineDiagnostic(line, tokenIndex, message, code, vscode.DiagnosticSeverity.Error);
}
