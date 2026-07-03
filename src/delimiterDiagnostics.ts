import * as vscode from "vscode";

import { DIAG_SOURCE } from "./diagnosticUtils";
import { findClosingBrace } from "./expressionParsing";
import { SampleDiagnostic } from "./expressionTypes";
import { ParsedLine } from "./parser";

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

function advancePastEscape(lineText: string, pos: number): number {
  const next = lineText[pos + 1];
  if (next === undefined) {
    return pos + 1;
  }
  if ("\\ \"'".includes(next) || next === "r" || next === "n" || next === "t") {
    return pos + 2;
  }
  return pos + 1;
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

  const close = lineText.indexOf("]", pos + 1);
  if (close < 0) {
    return { end: pos, unclosedBracketStart: pos };
  }
  return { end: close, unclosedBracketStart: -1 };
}

/** Line-oriented delimiter balance check (strings and # comments respected). */
export function validateLineDelimiters(lineText: string): DelimiterDiagnostic[] {
  if (!mightContainDelimiters(lineText)) {
    return [];
  }
  const issues: DelimiterDiagnostic[] = [];
  const stack: OpenDelimiter[] = [];
  let squote: QuoteKind | null = null;
  let dquote: QuoteKind | null = null;
  let quoteStart = 0;

  for (let i = 0; i < lineText.length; i += 1) {
    const ch = lineText[i];

    if (!squote && !dquote && ch === "#") {
      break;
    }

    if (ch === "\\" && dquote && !squote) {
      i = advancePastEscape(lineText, i) - 1;
      continue;
    }

    if (ch === '"') {
      if (squote) {
        continue;
      }
      if (dquote) {
        dquote = null;
      } else {
        dquote = '"';
        quoteStart = i;
      }
      continue;
    }

    if (ch === "'") {
      if (dquote) {
        continue;
      }
      if (squote) {
        squote = null;
      } else {
        squote = "'";
        quoteStart = i;
      }
      continue;
    }

    if (squote || dquote) {
      continue;
    }

    const percentBracketExpr = advancePastPercentBracketExpr(lineText, i);
    if (percentBracketExpr) {
      if (percentBracketExpr.unclosedBracketStart >= 0) {
        stack.push({ kind: "[", start: percentBracketExpr.unclosedBracketStart });
        break;
      }
      i = percentBracketExpr.end;
      continue;
    }

    if (ch === "{") {
      const close = findClosingBrace(lineText, i);
      if (close >= 0) {
        i = close;
        continue;
      }
      stack.push({ kind: ch, start: i });
      continue;
    }

    if (ch === "(" || ch === "[") {
      stack.push({ kind: ch, start: i });
      continue;
    }

    if (ch === ")" || ch === "]" || ch === "}") {
      const expected = CLOSING_FOR[ch];
      const top = stack[stack.length - 1];
      if (!top || top.kind !== expected) {
        issues.push(delimiterIssue(i, i + 1, `unexpected '${ch}'`, "delimiter-unexpected"));
        continue;
      }
      stack.pop();
    }
  }

  if (dquote) {
    issues.push(
      delimiterIssue(quoteStart, quoteStart + 1, "missing closing '\"'", "delimiter-unclosed"),
    );
  } else if (squote) {
    issues.push(
      delimiterIssue(quoteStart, quoteStart + 1, "missing closing '''", "delimiter-unclosed"),
    );
  }

  for (const open of stack) {
    issues.push(
      delimiterIssue(
        open.start,
        open.start + 1,
        `missing closing '${CLOSING_CHAR[open.kind]}'`,
        "delimiter-unclosed",
      ),
    );
  }

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
