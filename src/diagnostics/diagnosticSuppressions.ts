import * as vscode from "vscode";

import { commentStartIndex } from "../parser";

const SUPPRESSION_PATTERN = /^haproxy\s*:\s*ignore\s*=\s*(.*)$/i;
const SUPPRESSION_LIST_PATTERN =
  /^haproxy\s*:\s*ignore\s*=\s*([a-z0-9_.-]+(?:\s*,\s*[a-z0-9_.-]+)*)\b/i;
const DIAGNOSTIC_CODE_PATTERN = /^[a-z0-9_.-]+$/i;

export function diagnosticCodeText(code: vscode.Diagnostic["code"]): string | undefined {
  if (code === undefined) {
    return undefined;
  }
  if (typeof code === "object") {
    return String(code.value);
  }
  return String(code);
}

function normalizedDiagnosticCode(code: string): string | undefined {
  const normalized = code.trim().toLowerCase();
  return normalized.length > 0 && DIAGNOSTIC_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

export function ignoredDiagnosticCodesForLine(lineText: string): ReadonlySet<string> {
  const commentStart = commentStartIndex(lineText);
  if (commentStart < 0) {
    return new Set();
  }

  const comment = lineText.slice(commentStart + 1).trim();
  const match = SUPPRESSION_PATTERN.exec(comment);
  if (!match) {
    return new Set();
  }

  const codes = new Set<string>();
  const list = SUPPRESSION_LIST_PATTERN.exec(comment)?.[1] ?? match[1];
  for (const rawCode of list.split(",")) {
    const code = normalizedDiagnosticCode(rawCode);
    if (code) {
      codes.add(code);
    }
  }
  return codes;
}

export function lineTextWithIgnoredDiagnosticCode(lineText: string, code: string): string | null {
  const normalized = normalizedDiagnosticCode(code);
  if (!normalized) {
    return null;
  }
  if (ignoredDiagnosticCodesForLine(lineText).has(normalized)) {
    return null;
  }

  const commentStart = commentStartIndex(lineText);
  if (commentStart < 0) {
    return `${lineText} # haproxy: ignore=${normalized}`;
  }

  const commentBody = lineText.slice(commentStart + 1);
  const leadingWhitespace = commentBody.length - commentBody.trimStart().length;
  const commentText = commentBody.trim();
  const suppression = SUPPRESSION_LIST_PATTERN.exec(commentText);
  if (suppression) {
    const insertAt = commentStart + 1 + leadingWhitespace + suppression[0].length;
    return `${lineText.slice(0, insertAt)},${normalized}${lineText.slice(insertAt)}`;
  }

  return `${lineText.slice(0, commentStart)}# haproxy: ignore=${normalized} ${lineText
    .slice(commentStart + 1)
    .trimStart()}`;
}

export function applyDiagnosticSuppressions(
  lineTexts: readonly string[],
  diagnostics: vscode.Diagnostic[],
): vscode.Diagnostic[] {
  const ignoredByLine = new Map<number, ReadonlySet<string>>();
  let filtered: vscode.Diagnostic[] | undefined;

  for (let i = 0; i < diagnostics.length; i += 1) {
    const diagnostic = diagnostics[i];
    const code = diagnosticCodeText(diagnostic.code)?.toLowerCase();
    const line = diagnostic.range.start.line;
    let ignored = false;

    if (code && line >= 0 && line < lineTexts.length) {
      let ignoredCodes = ignoredByLine.get(line);
      if (!ignoredCodes) {
        ignoredCodes = ignoredDiagnosticCodesForLine(lineTexts[line] ?? "");
        ignoredByLine.set(line, ignoredCodes);
      }
      ignored = ignoredCodes.has(code);
    }

    if (ignored) {
      filtered ??= diagnostics.slice(0, i);
      continue;
    }

    if (filtered) {
      filtered.push(diagnostic);
    }
  }

  return filtered ?? diagnostics;
}
