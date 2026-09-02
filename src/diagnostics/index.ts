/** Computes and caches full-document HAProxy diagnostics. */

import * as vscode from "vscode";

import { persistDocumentSession } from "../document/sessionStore";
import { getDocumentAnalysis } from "../parser/documentAnalysis";
import { runLineDiagnosticPipeline } from "./diagnosticPipeline";
import { DiagnosticContext } from "./diagnosticContext";
import { HaproxyLanguageData } from "../language/languageData";
import { HaproxySchema } from "../schema/types";
import { UriLruCache } from "../core/uriLruCache";
import { fingerprintText } from "../core/contentFingerprint";
import { normalizeUriKey } from "../core/uriKey";
import {
  getSymbolIndex,
  getWorkspaceSymbolIndex,
  symbolIndexForWorkspaceDiagnostics,
  workspaceUriKey,
} from "../symbolIndex";
import { entryPointWithoutBindDiagnostics } from "./entryPointDiagnostics";
import { missingReferenceDiagnostics } from "./missingReferenceDiagnostics";
import { unusedSymbolDiagnostics } from "./unusedSymbolDiagnostics";
import { duplicateSectionDiagnostics } from "./duplicateSymbolDiagnostics";
import type { SymbolIndex, WorkspaceSymbolIndex } from "../symbolIndex";
import { applyDiagnosticSuppressions } from "./diagnosticSuppressions";

interface DiagnosticsCacheKey {
  schema: HaproxySchema;
  languageData: HaproxyLanguageData | undefined;
  deprecatedWarnings: boolean;
  unusedSymbols: boolean;
  missingReferences: boolean;
  maxSymbolLines?: number;
  workspaceGeneration: number | null;
  workspaceRevision: number | null;
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
  maxSymbolLines?: number;
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
    maxSymbolLines: options.maxSymbolLines,
    workspaceGeneration: workspaceIndex?.generation ?? null,
    workspaceRevision: workspaceIndex?.revision ?? null,
  };
}

function sameLineCacheKey(left: DiagnosticsCacheKey, right: DiagnosticsCacheKey): boolean {
  return (
    left.schema === right.schema &&
    left.languageData === right.languageData &&
    left.deprecatedWarnings === right.deprecatedWarnings
  );
}

function sameCacheKey(left: DiagnosticsCacheKey, right: DiagnosticsCacheKey): boolean {
  return (
    sameLineCacheKey(left, right) &&
    left.unusedSymbols === right.unusedSymbols &&
    left.missingReferences === right.missingReferences &&
    left.maxSymbolLines === right.maxSymbolLines &&
    left.workspaceGeneration === right.workspaceGeneration &&
    left.workspaceRevision === right.workspaceRevision
  );
}

function flattenDiagnostics(lineDiagnostics: vscode.Diagnostic[][]): vscode.Diagnostic[] {
  return lineDiagnostics.flatMap((diags) => diags);
}

type SymbolDiagnosticContext = Pick<
  DiagnosticContext,
  "parsed" | "schema" | "entryPointSections" | "bindDetectKeywords"
>;

function computeDocumentSymbolDiagnostics(
  document: vscode.TextDocument,
  ctx: SymbolDiagnosticContext,
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

function symbolContextFromAnalysis(
  analysis: ReturnType<typeof getDocumentAnalysis>,
): SymbolDiagnosticContext {
  return {
    parsed: analysis.parsed,
    schema: analysis.schema,
    entryPointSections: analysis.entryPointSections,
    bindDetectKeywords: analysis.bindDetectKeywords,
  };
}

function fillLineDiagnostics(
  ctx: DiagnosticContext,
  cached: DiagnosticsCacheEntry | undefined,
  key: DiagnosticsCacheKey,
): vscode.Diagnostic[][] {
  const reuse = ctx.parsedEntry.reuse;
  const previous =
    cached &&
    cached.version === reuse.previousVersion &&
    sameLineCacheKey(cached.key, key) &&
    cached.suppressDeprecated === ctx.suppressDeprecated
      ? cached
      : undefined;

  const lineDiagnostics = new Array<vscode.Diagnostic[]>(ctx.parsed.length);
  if (previous) {
    for (let i = 0; i < reuse.prefixLines; i += 1) {
      const reused = previous.lineDiagnostics[i];
      if (reused) {
        lineDiagnostics[i] = reused;
      }
    }
    if (reuse.suffixLines > 0) {
      const delta = ctx.parsed.length - previous.lineDiagnostics.length;
      for (let i = reuse.newSuffixStart; i < ctx.parsed.length; i += 1) {
        const reused = previous.lineDiagnostics[i - delta];
        if (reused) {
          lineDiagnostics[i] = reused;
        }
      }
    }
  }

  for (let i = 0; i < ctx.parsed.length; i += 1) {
    if (lineDiagnostics[i]) {
      continue;
    }
    lineDiagnostics[i] = runLineDiagnosticPipeline(ctx, ctx.parsed[i]);
  }
  return lineDiagnostics;
}

function lookupUriDiagnostics(
  document: vscode.TextDocument,
  uriKey: string,
): { fingerprint: string; hit: DiagnosticsCacheEntry | undefined } | undefined {
  if (!uriDiagnosticsCache.has(uriKey)) {
    return undefined;
  }
  const fingerprint = fingerprintText(document.getText());
  return { fingerprint, hit: uriDiagnosticsCache.get(uriKey, fingerprint) };
}

function persistOpenDocumentDiagnostics(
  document: vscode.TextDocument,
  uriKey: string,
  fingerprint: string | undefined,
  entry: DiagnosticsCacheEntry,
): void {
  const contentFingerprint = fingerprint ?? fingerprintText(document.getText());
  uriDiagnosticsCache.set(uriKey, contentFingerprint, entry);
  persistDocumentSession(document, contentFingerprint);
}

function appendSymbolDiagnostics(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  options: ComputeDiagnosticsOptions,
  key: DiagnosticsCacheKey,
  cached: DiagnosticsCacheEntry | undefined,
  symbolCtx: SymbolDiagnosticContext,
  workspaceIndex: WorkspaceSymbolIndex | null,
  maxSymbolLines: number,
  diagnostics: vscode.Diagnostic[],
): { cachedSymbolIndex: SymbolIndex | null; documentSymbolDiagnostics: vscode.Diagnostic[] } {
  const needSymbolDiagnostics = options.unusedSymbols || options.missingReferences !== false;
  if (!needSymbolDiagnostics) {
    return { cachedSymbolIndex: null, documentSymbolDiagnostics: [] };
  }
  const index = getSymbolIndex(document, schema, maxSymbolLines);
  if (!index) {
    if (options.unusedSymbols) {
      diagnostics.push(...entryPointWithoutBindDiagnostics(document, symbolCtx.parsed, symbolCtx));
    }
    return { cachedSymbolIndex: null, documentSymbolDiagnostics: [] };
  }
  const documentSymbolDiagnostics =
    cached?.cachedSymbolIndex === index && sameCacheKey(cached.key, key)
      ? cached.documentSymbolDiagnostics
      : computeDocumentSymbolDiagnostics(document, symbolCtx, index, workspaceIndex, options);
  diagnostics.push(...documentSymbolDiagnostics);
  return { cachedSymbolIndex: index, documentSymbolDiagnostics };
}

export function computeDiagnostics(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  options: ComputeDiagnosticsOptions = {},
): vscode.Diagnostic[] {
  const workspaceIndex = getWorkspaceSymbolIndex(document);
  const key = diagnosticsCacheKey(schema, options, workspaceIndex);
  const maxSymbolLines = options.maxSymbolLines ?? document.lineCount;
  const cached = diagnosticsCache.get(document);
  if (cached && cached.version === document.version && sameCacheKey(cached.key, key)) {
    return cached.diagnostics;
  }

  const uriKey = normalizeUriKey(document.uri);
  const uriLookup = cached ? undefined : lookupUriDiagnostics(document, uriKey);
  const uriHit = uriLookup?.hit;
  if (uriHit && sameCacheKey(uriHit.key, key)) {
    diagnosticsCache.set(document, { ...uriHit, version: document.version });
    return uriHit.diagnostics;
  }

  const analysis = getDocumentAnalysis(document, schema);
  let lineDiagnostics: vscode.Diagnostic[][];
  let suppressDeprecated: boolean;
  let symbolCtx: SymbolDiagnosticContext;
  if (uriHit && sameLineCacheKey(uriHit.key, key)) {
    lineDiagnostics = uriHit.lineDiagnostics;
    suppressDeprecated = uriHit.suppressDeprecated;
    symbolCtx = symbolContextFromAnalysis(analysis);
  } else {
    const ctx = new DiagnosticContext(document, schema, options, analysis);
    lineDiagnostics = fillLineDiagnostics(ctx, cached, key);
    suppressDeprecated = ctx.suppressDeprecated;
    symbolCtx = ctx;
  }

  const diagnostics = flattenDiagnostics(lineDiagnostics);
  const { cachedSymbolIndex, documentSymbolDiagnostics } = appendSymbolDiagnostics(
    document,
    schema,
    options,
    key,
    cached,
    symbolCtx,
    workspaceIndex,
    maxSymbolLines,
    diagnostics,
  );

  const finalDiagnostics = applyDiagnosticSuppressions(analysis.lineTexts, diagnostics);

  const entry: DiagnosticsCacheEntry = {
    version: document.version,
    key,
    suppressDeprecated,
    lineDiagnostics,
    diagnostics: finalDiagnostics,
    cachedSymbolIndex,
    documentSymbolDiagnostics,
  };
  diagnosticsCache.set(document, entry);
  if (!cached) {
    persistOpenDocumentDiagnostics(document, uriKey, uriLookup?.fingerprint, entry);
  }

  return finalDiagnostics;
}

export function finalizeDiagnosticsCacheForClosedDocument(document: vscode.TextDocument): void {
  const cached = diagnosticsCache.get(document);
  if (!cached) {
    return;
  }
  uriDiagnosticsCache.set(
    normalizeUriKey(document.uri),
    fingerprintText(document.getText()),
    cached,
  );
}

export function clearDiagnosticsCache(): void {
  uriDiagnosticsCache.clear();
}
