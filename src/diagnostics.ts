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

interface DiagnosticsCacheKey {
  schema: HaproxySchema;
  languageData: HaproxyLanguageData | undefined;
  deprecatedWarnings: boolean;
  unusedSymbols: boolean;
  unusedSymbolSections: boolean;
  maxLines: number | undefined;
}

interface DiagnosticsCacheEntry {
  version: number;
  key: DiagnosticsCacheKey;
  suppressDeprecated: boolean;
  lineDiagnostics: vscode.Diagnostic[][];
  diagnostics: vscode.Diagnostic[];
}

const diagnosticsCache = new WeakMap<vscode.TextDocument, DiagnosticsCacheEntry>();

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

function diagnosticsCacheKey(
  schema: HaproxySchema,
  options: ComputeDiagnosticsOptions,
): DiagnosticsCacheKey {
  return {
    schema,
    languageData: options.languageData,
    deprecatedWarnings: options.deprecatedWarnings !== false,
    unusedSymbols: options.unusedSymbols === true,
    unusedSymbolSections: options.unusedSymbolSections ?? true,
    maxLines: options.maxLines,
  };
}

function sameCacheKey(left: DiagnosticsCacheKey, right: DiagnosticsCacheKey): boolean {
  return (
    left.schema === right.schema &&
    left.languageData === right.languageData &&
    left.deprecatedWarnings === right.deprecatedWarnings &&
    left.unusedSymbols === right.unusedSymbols &&
    left.unusedSymbolSections === right.unusedSymbolSections &&
    left.maxLines === right.maxLines
  );
}

function lineDiagnosticsFor(ctx: DiagnosticContext, line: ParsedLine): vscode.Diagnostic[] {
  if (line.tokens.length === 0) {
    return [];
  }
  if (line.isSectionHeader) {
    return sectionHeaderDiagnostics(line);
  }
  if (isMacroLine(line, ctx.schema)) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const memo = ctx.getLineMemo(line);
  const topDiags = topLevelDiagnostics(ctx, line);
  diagnostics.push(...topDiags);
  if (topDiags.length === 0) {
    diagnostics.push(...statementDiagnostics(line, ctx.schema, memo.statementRule));
    diagnostics.push(...contextDiagnostics(ctx, line));
    diagnostics.push(...unknownNestedDiagnostics(ctx, line));
    diagnostics.push(...argumentModelDiagnostics(line, ctx.schema, memo, ctx.noPrefix));
  }
  diagnostics.push(...aclNameDiagnostics(line));
  const lineText = ctx.lineText(line);
  const delimiterIssues = validateLineDelimiters(lineText);
  diagnostics.push(...delimiterDiagnostics(line, delimiterIssues));
  diagnostics.push(...expressionDiagnostics(line, lineText, ctx.schema, delimiterIssues));
  diagnostics.push(...logFormatDiagnostics(line, lineText, ctx.schema));
  if (ctx.deprecatedIndex) {
    diagnostics.push(
      ...deprecatedDiagnostics(ctx, line, memo, ctx.deprecatedIndex, ctx.suppressDeprecated),
    );
  }
  diagnostics.push(...namedDefaultsDiagnostics(line, ctx.schema));
  return diagnostics;
}

function flattenDiagnostics(lineDiagnostics: vscode.Diagnostic[][]): vscode.Diagnostic[] {
  return lineDiagnostics.flatMap((diags) => diags);
}

export function computeDiagnostics(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  options: ComputeDiagnosticsOptions = {},
): vscode.Diagnostic[] {
  const ctx = new DiagnosticContext(document, schema, options);
  const key = diagnosticsCacheKey(schema, options);
  const cached = diagnosticsCache.get(document);
  const reuse = ctx.parsedEntry.reuse;
  const canReuseLines =
    cached &&
    cached.version === reuse.previousVersion &&
    sameCacheKey(cached.key, key) &&
    cached.suppressDeprecated === ctx.suppressDeprecated;

  const lineDiagnostics = new Array<vscode.Diagnostic[]>(ctx.parsed.length);
  if (canReuseLines) {
    for (let i = 0; i < reuse.prefixLines; i += 1) {
      lineDiagnostics[i] = cached.lineDiagnostics[i] ?? [];
    }
    if (reuse.suffixLines > 0) {
      const delta = ctx.parsed.length - cached.lineDiagnostics.length;
      for (let i = reuse.newSuffixStart; i < ctx.parsed.length; i += 1) {
        const oldIndex = i - delta;
        lineDiagnostics[i] = cached.lineDiagnostics[oldIndex] ?? [];
      }
    }
  }

  for (let i = 0; i < ctx.parsed.length; i += 1) {
    if (lineDiagnostics[i]) {
      continue;
    }
    lineDiagnostics[i] = lineDiagnosticsFor(ctx, ctx.parsed[i]);
  }

  const diagnostics = flattenDiagnostics(lineDiagnostics);

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

  diagnosticsCache.set(document, {
    version: document.version,
    key,
    suppressDeprecated: ctx.suppressDeprecated,
    lineDiagnostics,
    diagnostics,
  });

  return diagnostics;
}
