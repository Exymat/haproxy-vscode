import * as vscode from "vscode";

import { argumentModelDiagnostics } from "./argumentDiagnostics";
import { delimiterDiagnostics, validateLineDelimiters } from "./delimiterDiagnostics";
import { DiagnosticContext } from "./diagnosticContext";
import { deprecatedDiagnostics } from "./deprecatedDiagnostics";
import { expressionDiagnostics } from "./expressionDiagnostics";
import { logFormatDiagnostics } from "./logFormatDiagnostics";
import { namedDefaultsDiagnostics } from "./namedDefaultsDiagnostics";
import {
  contextDiagnostics,
  topLevelDiagnostics,
  unknownNestedDiagnostics,
} from "./nestedKeywordDiagnostics";
import { aclNameDiagnostics, sectionHeaderDiagnostics } from "./sectionDiagnostics";
import { statementDiagnostics } from "./statementDiagnostics";
import { ParsedLine } from "./parser";
import { macroTokenSet } from "./schema";

type LineDiagnosticPhase = (
  ctx: DiagnosticContext,
  line: ParsedLine,
  memo: ReturnType<DiagnosticContext["getLineMemo"]>,
) => vscode.Diagnostic[];

const CORE_PHASES: LineDiagnosticPhase[] = [
  (ctx, line, memo) => {
    const topDiags = topLevelDiagnostics(ctx, line);
    if (topDiags.length > 0) {
      return topDiags;
    }
    return [
      ...statementDiagnostics(line, ctx.schema, memo.statementRule),
      ...contextDiagnostics(ctx, line),
      ...unknownNestedDiagnostics(ctx, line),
      ...argumentModelDiagnostics(line, ctx.schema, memo, ctx.noPrefix),
    ];
  },
];

const TRAILING_PHASES: LineDiagnosticPhase[] = [
  (_ctx, line) => aclNameDiagnostics(line),
  (ctx, line) => {
    const lineText = ctx.lineText(line);
    const delimiterIssues = validateLineDelimiters(lineText);
    return [
      ...delimiterDiagnostics(line, delimiterIssues),
      ...expressionDiagnostics(line, lineText, ctx.schema, delimiterIssues),
      ...logFormatDiagnostics(line, lineText, ctx.schema, ctx.getLogFormatMemo(line)),
    ];
  },
  (ctx, line, memo) =>
    ctx.deprecatedIndex
      ? deprecatedDiagnostics(ctx, line, memo, ctx.deprecatedIndex, ctx.suppressDeprecated)
      : [],
  (ctx, line) => namedDefaultsDiagnostics(line, ctx.schema),
];

export function runLineDiagnosticPipeline(
  ctx: DiagnosticContext,
  line: ParsedLine,
): vscode.Diagnostic[] {
  if (line.tokens.length === 0) {
    return [];
  }
  if (line.isSectionHeader) {
    return sectionHeaderDiagnostics(line);
  }
  if (macroTokenSet(ctx.schema).has(line.tokens[0]?.text.toLowerCase() ?? "")) {
    return [];
  }

  const memo = ctx.getLineMemo(line);
  const diagnostics: vscode.Diagnostic[] = [];
  for (const phase of CORE_PHASES) {
    diagnostics.push(...phase(ctx, line, memo));
  }
  for (const phase of TRAILING_PHASES) {
    diagnostics.push(...phase(ctx, line, memo));
  }
  return diagnostics;
}
