/** Detects unbalanced parentheses, brackets, braces, and quotes on a line. */

import * as vscode from "vscode";

import { DIAG_SOURCE } from "./diagnosticUtils";
import { findClosingBrace, findClosingSquareBracket } from "../parser/expressionParsing";
import { commentStartIndex } from "../parser";
import { SampleDiagnostic } from "../parser/expressionTypes";
import { ParsedLine } from "../parser";

export type DelimiterDiagCode = "delimiter-unclosed" | "delimiter-unexpected";

export interface DelimiterDiagnostic {
  start: number;
  end: number;
  message: string;
  code: DelimiterDiagCode;
  source: typeof DIAG_SOURCE;
}

type DelimiterKind = "(" | "[" | "{";
type QuoteKind = '"' | "'";

const CLOSING_FOR: Record<string, DelimiterKind> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

const CLOSING_CHAR: Record<DelimiterKind, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

interface OpenDelimiter {
  kind: DelimiterKind;
  start: number;
}

function delimiterIssue(
  start: number,
  end: number,
  message: string,
  code: DelimiterDiagCode,
): DelimiterDiagnostic {
  return { start, end: Math.max(end, start + 1), message, code, source: DIAG_SOURCE };
}

function mightContainDelimiters(lineText: string): boolean {
  return (
    lineText.includes("#") ||
    lineText.includes('"') ||
    lineText.includes("'") ||
    lineText.includes("%") ||
    lineText.includes("(") ||
    lineText.includes(")") ||
    lineText.includes("[") ||
    lineText.includes("]") ||
    lineText.includes("{") ||
    lineText.includes("}")
  );
}

/** Skip %[expr] and %{flags}[expr] log-format sample wrappers (inner delimiters ignored). */
function advancePastPercentBracketExpr(
  lineText: string,
  start: number,
): { end: number; unclosedBracketStart: number } | null {
  if (lineText[start] !== "%" || start + 1 >= lineText.length) {
    return null;
  }
  if (lineText[start + 1] === "%") {
    return { end: start + 1, unclosedBracketStart: -1 };
  }

  let pos = start + 1;
  if (lineText[pos] === "(") {
    const close = lineText.indexOf(")", pos + 1);
    pos = close >= 0 ? close + 1 : lineText.length;
  }
  if (pos < lineText.length && lineText[pos] === "{") {
    const close = lineText.indexOf("}", pos + 1);
    pos = close >= 0 ? close + 1 : lineText.length;
  }
  if (pos >= lineText.length || lineText[pos] !== "[") {
    return null;
  }

  const close = findClosingSquareBracket(lineText, pos);
  if (close < 0) {
    return { end: pos, unclosedBracketStart: pos };
  }
  return { end: close, unclosedBracketStart: -1 };
}

interface DelimiterScanState {
  stack: OpenDelimiter[];
  squote: QuoteKind | null;
  dquote: QuoteKind | null;
  quoteStart: number;
}

function trySkipEscape(
  lineText: string,
  i: number,
  limit: number,
  state: DelimiterScanState,
): number | null {
  if (lineText[i] === "\\" && !state.squote && i + 1 < limit) {
    return i + 1;
  }
  return null;
}

function applyQuoteChar(ch: string, i: number, state: DelimiterScanState): boolean {
  if (ch === '"') {
    if (state.squote) {
      return true;
    }
    if (state.dquote) {
      state.dquote = null;
    } else {
      state.dquote = '"';
      state.quoteStart = i;
    }
    return true;
  }
  if (ch === "'") {
    if (state.dquote) {
      return true;
    }
    if (state.squote) {
      state.squote = null;
    } else {
      state.squote = "'";
      state.quoteStart = i;
    }
    return true;
  }
  return false;
}

function applyBareDelimiter(
  ch: string,
  i: number,
  lineText: string,
  state: DelimiterScanState,
  issues: DelimiterDiagnostic[],
): number | null {
  if (ch === "{") {
    const close = findClosingBrace(lineText, i);
    if (close >= 0) {
      return close;
    }
    state.stack.push({ kind: ch, start: i });
    return i;
  }
  if (ch === "(" || ch === "[") {
    state.stack.push({ kind: ch, start: i });
    return i;
  }
  if (ch === ")" || ch === "]" || ch === "}") {
    const expected = CLOSING_FOR[ch];
    const top = state.stack[state.stack.length - 1];
    if (!top || top.kind !== expected) {
      issues.push(delimiterIssue(i, i + 1, `unexpected '${ch}'`, "delimiter-unexpected"));
      return i;
    }
    state.stack.pop();
    return i;
  }
  return null;
}

function pushUnclosedQuoteIssues(state: DelimiterScanState, issues: DelimiterDiagnostic[]): void {
  if (state.dquote) {
    issues.push(
      delimiterIssue(
        state.quoteStart,
        state.quoteStart + 1,
        "missing closing '\"'",
        "delimiter-unclosed",
      ),
    );
    return;
  }
  if (state.squote) {
    issues.push(
      delimiterIssue(
        state.quoteStart,
        state.quoteStart + 1,
        "missing closing '''",
        "delimiter-unclosed",
      ),
    );
  }
}

function pushUnclosedDelimiterIssues(
  state: DelimiterScanState,
  issues: DelimiterDiagnostic[],
): void {
  for (const open of state.stack) {
    issues.push(
      delimiterIssue(
        open.start,
        open.start + 1,
        `missing closing '${CLOSING_CHAR[open.kind]}'`,
        "delimiter-unclosed",
      ),
    );
  }
}

/** Line-oriented delimiter balance check (# comments ignored; `[` `]` still count inside quotes). */
export function validateLineDelimiters(lineText: string): DelimiterDiagnostic[] {
  if (!mightContainDelimiters(lineText)) {
    return [];
  }
  const issues: DelimiterDiagnostic[] = [];
  const state: DelimiterScanState = {
    stack: [],
    squote: null,
    dquote: null,
    quoteStart: 0,
  };
  const commentStart = commentStartIndex(lineText);
  const limit = commentStart >= 0 ? commentStart : lineText.length;

  for (let i = 0; i < limit; i += 1) {
    const escapedAt = trySkipEscape(lineText, i, limit, state);
    if (escapedAt !== null) {
      i = escapedAt;
      continue;
    }

    const ch = lineText[i];
    if (applyQuoteChar(ch, i, state)) {
      continue;
    }
    if (state.squote || state.dquote) {
      // Log-format strings nest %[…] inside [sd-id …]; those brackets must balance.
      if (ch === "[" || ch === "]") {
        applyBareDelimiter(ch, i, lineText, state, issues);
      }
      continue;
    }

    const percentBracketExpr = advancePastPercentBracketExpr(lineText, i);
    if (percentBracketExpr) {
      if (percentBracketExpr.unclosedBracketStart >= 0) {
        state.stack.push({ kind: "[", start: percentBracketExpr.unclosedBracketStart });
        break;
      }
      i = percentBracketExpr.end;
      continue;
    }

    const delimiterAt = applyBareDelimiter(ch, i, lineText, state, issues);
    if (delimiterAt !== null) {
      i = delimiterAt;
    }
  }

  pushUnclosedQuoteIssues(state, issues);
  pushUnclosedDelimiterIssues(state, issues);
  return issues;
}

export function filterExpressionIssuesAgainstDelimiters(
  expressionIssues: SampleDiagnostic[],
  delimiterIssues: DelimiterDiagnostic[],
): SampleDiagnostic[] {
  const missingClose = new Set(
    delimiterIssues
      .filter((issue) => issue.code === "delimiter-unclosed")
      .map((issue) => {
        const match = /^missing closing '(.)'$/.exec(issue.message);
        return match?.[1];
      })
      .filter((ch): ch is string => ch !== undefined),
  );

  if (missingClose.size === 0) {
    return expressionIssues;
  }

  return expressionIssues.filter((issue) => {
    if (
      issue.code === "sample-syntax" &&
      issue.message === "expected ')'" &&
      (missingClose.has(")") || missingClose.has("]"))
    ) {
      return false;
    }
    if (
      issue.code === "sample-syntax" &&
      issue.message === "unclosed quote in argument" &&
      (missingClose.has('"') || missingClose.has("'"))
    ) {
      return false;
    }
    return true;
  });
}

export function delimiterDiagnostics(
  line: ParsedLine,
  issues: DelimiterDiagnostic[],
): vscode.Diagnostic[] {
  return issues.map((issue) => {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line.line, issue.start, line.line, issue.end),
      issue.message,
      vscode.DiagnosticSeverity.Error,
    );
    diagnostic.source = issue.source;
    diagnostic.code = issue.code;
    return diagnostic;
  });
}
