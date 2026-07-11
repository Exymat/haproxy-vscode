import * as vscode from "vscode";

import { DiagnosticContext, LineDiagnosticMemo } from "./diagnosticContext";
import { diagRange, diagRangeForMatch, diagRangeForTokens } from "./diagnosticUtils";
import { DeprecatedIndex } from "../language/deprecatedIndex";
import { ParsedLine } from "../parser";
import { HaproxySchema } from "../schema/types";
import { resolveActionTokenIndex } from "../formatting/statementLayout";
import { normalizeActionName } from "../parser/tokenUtils";

export { documentUsesExposeDeprecatedDirectives } from "./deprecatedUtils";

function stripSampleArgs(raw: string): string {
  const parenIndex = raw.indexOf("(");
  return (parenIndex >= 0 ? raw.slice(0, parenIndex) : raw).toLowerCase();
}

function sampleRefsInToken(tokenText: string): Array<{ name: string; start: number }> {
  const refs: Array<{ name: string; start: number }> = [];
  const re = /[A-Za-z_][A-Za-z0-9_.-]*/g;
  for (const match of tokenText.matchAll(re)) {
    refs.push({ name: match[0], start: match.index ?? 0 });
  }
  return refs;
}

function deprecatedLineDiagnostics(
  line: ParsedLine,
  schema: HaproxySchema,
  index: DeprecatedIndex,
  memo: LineDiagnosticMemo,
): vscode.Diagnostic[] {
  const match = memo.directiveMatch;
  if (!match.matched) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const keyword = match.keyword.toLowerCase();
  if (index.keywords.has(keyword)) {
    const diagnostic = new vscode.Diagnostic(
      diagRangeForTokens(line, match.start, match.end),
      `'${match.keyword}' is deprecated in HAProxy ${schema.version}`,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = "haproxy";
    diagnostic.code = "deprecated-keyword";
    diagnostics.push(diagnostic);
  }

  if (line.tokens[0]?.text.toLowerCase() === "acl" && line.tokens.length >= 3) {
    const rawCriterion = line.tokens[2].text;
    const criterion = stripSampleArgs(rawCriterion);
    if (index.sampleFetches.has(criterion)) {
      const diagnostic = new vscode.Diagnostic(
        diagRange(line, 2),
        `'${rawCriterion}' is a deprecated sample fetch in HAProxy ${schema.version}`,
        vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = "haproxy";
      diagnostic.code = "deprecated-sample";
      diagnostics.push(diagnostic);
    }
  }

  for (let tokenIndex = 0; tokenIndex < line.tokens.length; tokenIndex += 1) {
    if (line.tokens[0]?.text.toLowerCase() === "acl" && tokenIndex === 2) {
      continue;
    }
    const token = line.tokens[tokenIndex];
    if (!/[%(,]/.test(token.text)) {
      continue;
    }
    for (const ref of sampleRefsInToken(token.text)) {
      const lower = ref.name.toLowerCase();
      const isFetch = index.sampleFetches.has(lower);
      const isConverter = index.sampleConverters.has(lower);
      if (!isFetch && !isConverter) {
        continue;
      }
      const diagnostic = new vscode.Diagnostic(
        diagRangeForMatch(line, tokenIndex, ref.start, ref.name.length),
        `'${ref.name}' is a deprecated ${isConverter ? "sample converter" : "sample fetch"} in HAProxy ${schema.version}`,
        vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = "haproxy";
      diagnostic.code = "deprecated-sample";
      diagnostics.push(diagnostic);
    }
  }

  const rule = memo.statementRule;
  const actionIdx = resolveActionTokenIndex(rule, line);
  if (actionIdx === null) {
    return diagnostics;
  }

  const rawAction = line.tokens[actionIdx].text;
  const action = normalizeActionName(rawAction);
  if (!index.actions.has(action)) {
    return diagnostics;
  }

  const ruleset = line.tokens[0].text;
  const diagnostic = new vscode.Diagnostic(
    diagRange(line, actionIdx),
    `'${rawAction}' is a deprecated ${ruleset} action in HAProxy ${schema.version}`,
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = "haproxy";
  diagnostic.code = "deprecated-action";
  diagnostics.push(diagnostic);
  return diagnostics;
}

export function deprecatedDiagnostics(
  ctx: DiagnosticContext,
  line: ParsedLine,
  memo: LineDiagnosticMemo,
  index: DeprecatedIndex,
  suppress: boolean,
): vscode.Diagnostic[] {
  if (suppress || line.tokens.length === 0 || line.isSectionHeader) {
    return [];
  }
  return deprecatedLineDiagnostics(line, ctx.schema, index, memo);
}
