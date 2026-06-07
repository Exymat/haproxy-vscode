import * as vscode from "vscode";

import { argumentModelDiagnostics } from "./argumentDiagnostics";
import { DiagnosticContext } from "./diagnosticContext";
import { deprecatedDiagnostics } from "./deprecatedDiagnostics";
import { expressionDiagnostics } from "./expressionDiagnostics";
import { namedDefaultsDiagnostics } from "./namedDefaultsDiagnostics";
import {
  contextDiagnostics,
  topLevelDiagnostics,
  unknownNestedDiagnostics,
} from "./nestedKeywordDiagnostics";
import { aclNameDiagnostics, sectionHeaderDiagnostics } from "./sectionDiagnostics";
import { statementDiagnostics } from "./statementDiagnostics";
import { HaproxyLanguageData } from "./languageData";
import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema";

export interface ComputeDiagnosticsOptions {
  languageData?: HaproxyLanguageData;
  deprecatedWarnings?: boolean;
}

function isMacroLine(line: ParsedLine, schema: HaproxySchema): boolean {
  const first = line.tokens[0]?.text.toLowerCase();
  return (schema.tokens.macros ?? []).some((macro) => first === macro.toLowerCase());
}

export function computeDiagnostics(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  options: ComputeDiagnosticsOptions = {},
): vscode.Diagnostic[] {
  const ctx = new DiagnosticContext(document, schema, options);
  const diagnostics: vscode.Diagnostic[] = [];

  for (const line of ctx.parsed) {
    if (line.tokens.length === 0) {
      continue;
    }
    if (line.isSectionHeader) {
      diagnostics.push(...sectionHeaderDiagnostics(line));
      continue;
    }
    if (isMacroLine(line, schema)) {
      continue;
    }

    const memo = ctx.getLineMemo(line);
    const topDiags = topLevelDiagnostics(ctx, line);
    diagnostics.push(...topDiags);
    if (topDiags.length === 0) {
      diagnostics.push(...statementDiagnostics(line, schema));
      diagnostics.push(...contextDiagnostics(ctx, line));
      diagnostics.push(...unknownNestedDiagnostics(ctx, line));
      diagnostics.push(...argumentModelDiagnostics(line, schema, memo, ctx.noPrefix));
    }
    diagnostics.push(...aclNameDiagnostics(line));
    diagnostics.push(...expressionDiagnostics(line, ctx.lineText(line), schema));
    if (ctx.deprecatedIndex) {
      diagnostics.push(
        ...deprecatedDiagnostics(ctx, line, memo, ctx.deprecatedIndex, ctx.suppressDeprecated),
      );
    }
    diagnostics.push(...namedDefaultsDiagnostics(line, schema));
  }
  return diagnostics;
}
