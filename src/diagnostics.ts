import * as vscode from "vscode";

import { documentContentFingerprint, documentUriKey } from "./documentUriKey";
import { getDocumentAnalysis } from "./documentAnalysis";
import { runLineDiagnosticPipeline } from "./diagnosticPipeline";
import { DiagnosticContext } from "./diagnosticContext";
import { HaproxyLanguageData } from "./languageData";
import { HaproxySchema } from "./schema/types";
import { UriLruCache } from "./uriLruCache";
import {
  getSymbolIndex,
  getWorkspaceSymbolIndex,
  symbolIndexForWorkspaceDiagnostics,
  workspaceUriKey,
} from "./symbolIndex";
import { entryPointWithoutBindDiagnostics } from "./entryPointDiagnostics";
import { missingReferenceDiagnostics } from "./missingReferenceDiagnostics";
import { unusedSymbolDiagnostics } from "./unusedSymbolDiagnostics";
import { duplicateSectionDiagnostics } from "./duplicateSymbolDiagnostics";
import type { SymbolIndex, WorkspaceSymbolIndex } from "./symbolIndex";
import { applyDiagnosticSuppressions } from "./diagnosticSuppressions";

interface DiagnosticsCacheKey {
  schema: HaproxySchema;
  languageData: HaproxyLanguageData | undefined;
  deprecatedWarnings: boolean;
  unusedSymbols: boolean;
  missingReferences: boolean;
  maxLines: number | undefined;
  workspaceGeneration: number | null;
}

interface DiagnosticsCacheEntry {
  version: number;
  key: DiagnosticsCacheKey;
  suppressDeprecated: boolean;
  lineDiagnostics: vscode.Diagnostic[][];
  diagnostics: vscode.Diagnostic[];
  cachedSymbolIndex: SymbolIndex | null;
  documentSymbolDiagnostics: vscode.Diagnostic[];
}

const diagnosticsCache = new WeakMap<vscode.TextDocument, DiagnosticsCacheEntry>();
const uriDiagnosticsCache = new UriLruCache<DiagnosticsCacheEntry>(32);

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
  workspaceIndex: WorkspaceSymbolIndex | null,
): DiagnosticsCacheKey {
  return {
    schema,
    languageData: options.languageData,
    deprecatedWarnings: options.deprecatedWarnings !== false,
    unusedSymbols: options.unusedSymbols === true,
    missingReferences: options.missingReferences !== false,
    maxLines: options.maxLines,
    workspaceGeneration: workspaceIndex?.generation ?? null,
  };
}

function sameCacheKey(left: DiagnosticsCacheKey, right: DiagnosticsCacheKey): boolean {
  return (
    left.schema === right.schema &&
    left.languageData === right.languageData &&
    left.deprecatedWarnings === right.deprecatedWarnings &&
    left.unusedSymbols === right.unusedSymbols &&
    left.missingReferences === right.missingReferences &&
    left.maxLines === right.maxLines &&
    left.workspaceGeneration === right.workspaceGeneration
  );
}

function flattenDiagnostics(lineDiagnostics: vscode.Diagnostic[][]): vscode.Diagnostic[] {
  return lineDiagnostics.flatMap((diags) => diags);
}

function computeDocumentSymbolDiagnostics(
  document: vscode.TextDocument,
  ctx: DiagnosticContext,
  index: SymbolIndex,
  workspaceIndex: WorkspaceSymbolIndex | null,
  options: ComputeDiagnosticsOptions,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const effectiveIndex = symbolIndexForWorkspaceDiagnostics(document, index, workspaceIndex);

  if (options.unusedSymbols) {
    diagnostics.push(
      ...unusedSymbolDiagnostics(document, ctx.parsed, effectiveIndex, ctx, { enabled: true }),
    );
    diagnostics.push(...entryPointWithoutBindDiagnostics(document, ctx.parsed, ctx));
  }
  if (options.missingReferences !== false) {
    const missingReferenceScope =
      workspaceIndex && workspaceIndex.documents.has(workspaceUriKey(document.uri))
        ? "workspace"
        : "file";
    diagnostics.push(
      ...missingReferenceDiagnostics(effectiveIndex, ctx.schema, {
        scope: missingReferenceScope,
      }),
    );
  }
  diagnostics.push(
    ...duplicateSectionDiagnostics(document, ctx.parsed, workspaceIndex, ctx.schema),
  );

  return diagnostics;
}

export function computeDiagnostics(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  options: ComputeDiagnosticsOptions = {},
): vscode.Diagnostic[] {
  const workspaceIndex = getWorkspaceSymbolIndex(document);
  const key = diagnosticsCacheKey(schema, options, workspaceIndex);
  const contentFingerprint = documentContentFingerprint(document);
  const uriHit = uriDiagnosticsCache.get(documentUriKey(document), contentFingerprint);
  const analysis = getDocumentAnalysis(document, schema);
  if (uriHit && sameCacheKey(uriHit.key, key)) {
    diagnosticsCache.set(document, { ...uriHit, version: document.version });
    return uriHit.diagnostics;
  }

  const ctx = new DiagnosticContext(document, schema, options, analysis);
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
      lineDiagnostics[i] = cached.lineDiagnostics[i]!;
    }
    if (reuse.suffixLines > 0) {
      const delta = ctx.parsed.length - cached.lineDiagnostics.length;
      for (let i = reuse.newSuffixStart; i < ctx.parsed.length; i += 1) {
        const oldIndex = i - delta;
        lineDiagnostics[i] = cached.lineDiagnostics[oldIndex]!;
      }
    }
  }

  for (let i = 0; i < ctx.parsed.length; i += 1) {
    if (lineDiagnostics[i]) {
      continue;
    }
    lineDiagnostics[i] = runLineDiagnosticPipeline(ctx, ctx.parsed[i]);
  }

  const diagnostics = flattenDiagnostics(lineDiagnostics);

  const needSymbolDiagnostics = options.unusedSymbols || options.missingReferences !== false;
  let documentSymbolDiagnostics: vscode.Diagnostic[] = [];
  let cachedSymbolIndex: SymbolIndex | null = null;

  if (needSymbolDiagnostics) {
    const maxLines = options.maxLines ?? document.lineCount;
    const index = getSymbolIndex(document, schema, maxLines);
    if (index) {
      cachedSymbolIndex = index;
      if (cached?.cachedSymbolIndex === index && sameCacheKey(cached.key, key)) {
        documentSymbolDiagnostics = cached.documentSymbolDiagnostics;
      } else {
        documentSymbolDiagnostics = computeDocumentSymbolDiagnostics(
          document,
          ctx,
          index,
          workspaceIndex,
          options,
        );
      }
      diagnostics.push(...documentSymbolDiagnostics);
    } else if (options.unusedSymbols) {
      diagnostics.push(...entryPointWithoutBindDiagnostics(document, ctx.parsed, ctx));
    }
  }

  const finalDiagnostics = applyDiagnosticSuppressions(ctx.lineTexts, diagnostics);

  diagnosticsCache.set(document, {
    version: document.version,
    key,
    suppressDeprecated: ctx.suppressDeprecated,
    lineDiagnostics,
    diagnostics: finalDiagnostics,
    cachedSymbolIndex,
    documentSymbolDiagnostics,
  });
  uriDiagnosticsCache.set(documentUriKey(document), contentFingerprint, {
    version: document.version,
    key,
    suppressDeprecated: ctx.suppressDeprecated,
    lineDiagnostics,
    diagnostics: finalDiagnostics,
    cachedSymbolIndex,
    documentSymbolDiagnostics,
  });

  return finalDiagnostics;
}
