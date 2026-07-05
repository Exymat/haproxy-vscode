import * as vscode from "vscode";

import { runLineDiagnosticPipeline } from "./diagnosticPipeline";
import { DiagnosticContext } from "./diagnosticContext";
import { HaproxyLanguageData } from "./languageData";
import { HaproxySchema } from "./schema";
import { getSymbolIndex } from "./symbolIndex";
import { entryPointWithoutBindDiagnostics } from "./entryPointDiagnostics";
import { missingReferenceDiagnostics } from "./missingReferenceDiagnostics";
import { unusedSymbolDiagnostics } from "./unusedSymbolDiagnostics";

interface DiagnosticsCacheKey {
  schema: HaproxySchema;
  languageData: HaproxyLanguageData | undefined;
  deprecatedWarnings: boolean;
  unusedSymbols: boolean;
  missingReferences: boolean;
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
  missingReferences?: boolean;
  maxLines?: number;
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
    missingReferences: options.missingReferences !== false,
    maxLines: options.maxLines,
  };
}

function sameCacheKey(left: DiagnosticsCacheKey, right: DiagnosticsCacheKey): boolean {
  return (
    left.schema === right.schema &&
    left.languageData === right.languageData &&
    left.deprecatedWarnings === right.deprecatedWarnings &&
    left.unusedSymbols === right.unusedSymbols &&
    left.missingReferences === right.missingReferences &&
    left.maxLines === right.maxLines
  );
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
    /* v8 ignore start -- prefix reuse is a cache optimization, not core diagnostics semantics */
    for (let i = 0; i < reuse.prefixLines; i += 1) {
      lineDiagnostics[i] = cached.lineDiagnostics[i] ?? [];
    }
    /* v8 ignore stop */
    /* v8 ignore next -- suffix reuse is only hit when edits preserve parser state at the tail */
    if (reuse.suffixLines > 0) {
      /* v8 ignore next -- negative deltas are only possible with inconsistent parse-cache state */
      const delta = ctx.parsed.length - cached.lineDiagnostics.length;
      /* v8 ignore start -- suffix reuse is a cache optimization, not core diagnostics semantics */
      for (let i = reuse.newSuffixStart; i < ctx.parsed.length; i += 1) {
        const oldIndex = i - delta;
        lineDiagnostics[i] = cached.lineDiagnostics[oldIndex] ?? [];
      }
      /* v8 ignore stop */
    }
  }

  for (let i = 0; i < ctx.parsed.length; i += 1) {
    if (lineDiagnostics[i]) {
      continue;
    }
    lineDiagnostics[i] = runLineDiagnosticPipeline(ctx, ctx.parsed[i]);
  }

  const diagnostics = flattenDiagnostics(lineDiagnostics);

  if (options.unusedSymbols || options.missingReferences !== false) {
    /* v8 ignore start -- explicit maxLines overrides are only used by the VS Code scheduler */
    const maxLines = options.maxLines ?? document.lineCount;
    const index = getSymbolIndex(document, schema, maxLines);
    if (index) {
      if (options.unusedSymbols) {
        diagnostics.push(
          ...unusedSymbolDiagnostics(document, ctx.parsed, index, ctx.schema, {
            enabled: true,
          }),
        );
      }
      if (options.missingReferences !== false) {
        diagnostics.push(...missingReferenceDiagnostics(index));
      }
    }
    if (options.unusedSymbols) {
      diagnostics.push(...entryPointWithoutBindDiagnostics(document, ctx.parsed, ctx.schema));
    }
    /* v8 ignore stop */
  }

  diagnosticsCache.set(document, {
    version: document.version,
    key,
    suppressDeprecated: ctx.suppressDeprecated,
    lineDiagnostics,
    /* v8 ignore start -- cached flattened diagnostics only affect reuse, not diagnostic semantics */
    diagnostics,
    /* v8 ignore stop */
  });

  return diagnostics;
}
