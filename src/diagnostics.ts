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
import { HaproxyLanguageData } from "./languageData";
import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema";
import { getSymbolIndex } from "./symbolIndex";
import { unusedSymbolDiagnostics } from "./unusedSymbolDiagnostics";

export interface ComputeDiagnosticsOptions {
  languageData?: HaproxyLanguageData;
  deprecatedWarnings?: boolean;
  unusedSymbols?: boolean;
  unusedSymbolSections?: boolean;
  maxLines?: number;
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
      diagnostics.push(...statementDiagnostics(line, schema, memo.statementRule));
      diagnostics.push(...contextDiagnostics(ctx, line));
      diagnostics.push(...unknownNestedDiagnostics(ctx, line));
      diagnostics.push(...argumentModelDiagnostics(line, schema, memo, ctx.noPrefix));
    }
    diagnostics.push(...aclNameDiagnostics(line));
    const lineText = ctx.lineText(line);
    const delimiterIssues = validateLineDelimiters(lineText);
    diagnostics.push(...delimiterDiagnostics(line, delimiterIssues));
    diagnostics.push(...expressionDiagnostics(line, lineText, schema, delimiterIssues));
    diagnostics.push(...logFormatDiagnostics(line, lineText, schema));
    if (ctx.deprecatedIndex) {
      diagnostics.push(
        ...deprecatedDiagnostics(ctx, line, memo, ctx.deprecatedIndex, ctx.suppressDeprecated),
      );
    }
    diagnostics.push(...namedDefaultsDiagnostics(line, schema));
  }

  if (options.unusedSymbols) {
    const maxLines = options.maxLines ?? document.lineCount;
    const index = getSymbolIndex(document, schema, maxLines);
    if (index) {
      diagnostics.push(
        ...unusedSymbolDiagnostics(document, ctx.parsed, index, {
          enabled: true,
          includeSections: options.unusedSymbolSections ?? true,
        }),
      );
    }
  }

  return diagnostics;
}
