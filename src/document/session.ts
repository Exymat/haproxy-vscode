/** Unified per-document derived state: parse, analysis, modes, conditionals, and symbols. */
import * as vscode from "vscode";

import { fingerprintText } from "../core/contentFingerprint";
import { normalizeUriKey } from "../core/uriKey";
import {
  DocumentSessionRecord,
  DocumentSessionSymbols,
  documentSessionGeneration,
  getLiveSession,
  liveSessionsForDocument,
  setLiveSession,
  uriSessionHasSymbols,
  hasUriSessionKey,
  clearDocumentSessions,
} from "./sessionStore";
import {
  conditionalBranchInfoForDocument,
  isConditionalBlockDirective,
  isInactiveConditionalBranch,
} from "../parser/conditionalDirectives";
import { DocumentAnalysis } from "../parser/documentAnalysis";
import { getParsedDocumentEntry } from "../parser/parseCache";
import { parseOptionsKey } from "../parser/parseIncremental";
import { runtimeModeForDocument, RuntimeModeCacheEntry } from "../parser/sectionMode";
import { isTopLevelSectionHeader } from "../language/sectionUtils";
import { HaproxySchema } from "../schema/types";
import { sectionHeaderSet } from "../schema/layout";
import {
  buildSymbolIndexWithFingerprints,
  collectLineSymbolSites,
  patchSymbolIndexLine,
  symbolSiteFingerprint,
} from "../symbolIndex/build";
import { createSymbolBuildContext } from "../symbolIndex/context";
import { SymbolIndex } from "../symbolIndex/types";
import { ParsedDocumentEntry } from "../parser/parseIncremental";
import { ParsedLine } from "../parser";

export interface DocumentSession {
  readonly document: vscode.TextDocument;
  readonly schema: HaproxySchema;
  readonly version: number;
  readonly parse: ParsedDocumentEntry;
  readonly analysis: DocumentAnalysis;
  readonly modes: RuntimeModeCacheEntry;
  readonly branches: NonNullable<DocumentSessionRecord["branches"]>;
  readonly hasLuaLoad: boolean;
  readonly symbols: SymbolIndex | null;
  readonly symbolLineFingerprints: string[];
}

function schemaParseOptions(schema: HaproxySchema) {
  return { sectionHeaders: sectionHeaderSet(schema) };
}

function liveRecordForParse(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  parse: ParsedDocumentEntry,
): DocumentSessionRecord {
  const optionsKey = parseOptionsKey(schemaParseOptions(schema));
  const existing = getLiveSession(document, optionsKey);
  if (!existing) {
    const created: DocumentSessionRecord = {
      generation: documentSessionGeneration(),
      optionsKey,
      version: document.version,
      schema,
      parse,
    };
    setLiveSession(document, created);
    return created;
  }
  if (existing.parse !== parse) {
    existing.parse = parse;
    existing.version = document.version;
    existing.analysis = undefined;
    existing.branches = undefined;
    existing.hasLuaLoad = undefined;
  }
  return existing;
}

function requireLiveRecord(
  document: vscode.TextDocument,
  schema: HaproxySchema,
): DocumentSessionRecord {
  const parse = getParsedDocumentEntry(document, schemaParseOptions(schema));
  return liveRecordForParse(document, schema, parse);
}

function documentHasLuaLoad(parsed: ParsedLine[]): boolean {
  return parsed.some((line) => {
    const first = line.tokens[0]?.text.toLowerCase();
    return first === "lua-load" || first === "lua-load-per-thread";
  });
}

function ensureSchemaIdentity(record: DocumentSessionRecord, schema: HaproxySchema): void {
  if (record.schema === schema) {
    return;
  }
  record.schema = schema;
  record.analysis = undefined;
  record.modes = undefined;
  record.branches = undefined;
  record.hasLuaLoad = undefined;
  record.symbols = undefined;
}

function ensureAnalysis(
  document: vscode.TextDocument,
  record: DocumentSessionRecord,
  schema: HaproxySchema,
): DocumentAnalysis {
  if (!record.analysis) {
    record.analysis = new DocumentAnalysis(document, schema, record.parse);
  }
  return record.analysis;
}

function ensureModes(record: DocumentSessionRecord, schema: HaproxySchema): RuntimeModeCacheEntry {
  if (record.modes?.version === record.version) {
    return record.modes;
  }
  record.modes = runtimeModeForDocument(
    record.parse.parsed,
    record.version,
    record.parse.reuse,
    record.modes,
    schema,
  );
  return record.modes;
}

function ensureBranches(
  record: DocumentSessionRecord,
): NonNullable<DocumentSessionRecord["branches"]> {
  if (!record.branches) {
    record.branches = conditionalBranchInfoForDocument(record.parse.parsed);
  }
  return record.branches;
}

function ensureLuaLoad(record: DocumentSessionRecord): boolean {
  if (record.hasLuaLoad === undefined) {
    record.hasLuaLoad = documentHasLuaLoad(record.parse.parsed);
  }
  return record.hasLuaLoad;
}

function dirtyLineCount(entry: ParsedDocumentEntry): number {
  return entry.parsed.length - entry.reuse.prefixLines - entry.reuse.suffixLines;
}

function singleDirtyLineNo(parseEntry: ParsedDocumentEntry): number | null {
  if (dirtyLineCount(parseEntry) !== 1) {
    return null;
  }
  return parseEntry.reuse.prefixLines;
}

function canReuseSymbolIndex(
  cached: DocumentSessionSymbols,
  parseEntry: ParsedDocumentEntry,
  schema: HaproxySchema,
  branches: NonNullable<DocumentSessionRecord["branches"]>,
): boolean {
  const dirtyLineNo = singleDirtyLineNo(parseEntry);
  if (dirtyLineNo === null || parseEntry.reuse.previousVersion === null) {
    return false;
  }
  if (parseEntry.parsed.length !== cached.lineFingerprints.length) {
    return false;
  }
  const line = parseEntry.parsed[dirtyLineNo];
  if (!line || isTopLevelSectionHeader(line) || isConditionalBlockDirective(line.tokens[0]?.text)) {
    return false;
  }
  if (isInactiveConditionalBranch(branches[dirtyLineNo]?.branchState ?? "active")) {
    return symbolSiteFingerprint([]) === cached.lineFingerprints[dirtyLineNo];
  }
  const scopeKey = cached.index?.scopeKeyByLine[dirtyLineNo] ?? null;
  const buildContext = createSymbolBuildContext(schema);
  return (
    symbolSiteFingerprint(collectLineSymbolSites(line, schema, scopeKey, buildContext)) ===
    cached.lineFingerprints[dirtyLineNo]
  );
}

function canIncrementalPatch(parseEntry: ParsedDocumentEntry): boolean {
  const dirtyLineNo = singleDirtyLineNo(parseEntry);
  if (dirtyLineNo === null) {
    return false;
  }
  const line = parseEntry.parsed[dirtyLineNo];
  return Boolean(
    line && !isTopLevelSectionHeader(line) && !isConditionalBlockDirective(line.tokens[0]?.text),
  );
}

function patchSymbolsForDirtyLine(
  cached: DocumentSessionSymbols,
  parseEntry: ParsedDocumentEntry,
  schema: HaproxySchema,
  branches: NonNullable<DocumentSessionRecord["branches"]>,
): DocumentSessionSymbols | undefined {
  if (!cached.index || !canIncrementalPatch(parseEntry)) {
    return undefined;
  }
  const dirtyLineNo = parseEntry.reuse.prefixLines;
  const line = parseEntry.parsed[dirtyLineNo];
  const buildContext = createSymbolBuildContext(schema);
  const sites = isInactiveConditionalBranch(branches[dirtyLineNo]?.branchState ?? "active")
    ? []
    : collectLineSymbolSites(
        line,
        schema,
        cached.index.scopeKeyByLine[dirtyLineNo] ?? null,
        buildContext,
      );
  const { index, lineFingerprints } = patchSymbolIndexLine(cached.index, line, sites, buildContext);
  const nextFingerprints = [...cached.lineFingerprints];
  nextFingerprints[dirtyLineNo] = lineFingerprints[0] ?? "";
  return {
    index,
    lineFingerprints: nextFingerprints,
    maxLines: cached.maxLines,
    version: cached.version,
  };
}

function buildSymbols(
  parseEntry: ParsedDocumentEntry,
  schema: HaproxySchema,
  maxLines: number,
  hadPrevious: boolean,
  version: number,
): DocumentSessionSymbols {
  const { index, lineFingerprints } = buildSymbolIndexWithFingerprints(parseEntry.parsed, schema, {
    computeFingerprints: hadPrevious,
    buildSitesByLine: true,
  });
  return { index, lineFingerprints, maxLines, version };
}

function ensureSymbols(
  document: vscode.TextDocument,
  record: DocumentSessionRecord,
  schema: HaproxySchema,
  maxLines: number,
): DocumentSessionSymbols {
  const cached = record.symbols;
  if (cached && cached.version === document.version && cached.maxLines === maxLines) {
    if (cached.index !== null || document.lineCount > maxLines) {
      return cached;
    }
  }
  if (document.lineCount > maxLines) {
    record.symbols = { index: null, lineFingerprints: [], maxLines, version: document.version };
    return record.symbols;
  }

  const branches = ensureBranches(record);
  if (cached?.index && cached.maxLines === maxLines) {
    if (canReuseSymbolIndex(cached, record.parse, schema, branches)) {
      record.symbols = { ...cached, maxLines, version: document.version };
      return record.symbols;
    }
    const patched = patchSymbolsForDirtyLine(cached, record.parse, schema, branches);
    if (patched) {
      patched.maxLines = maxLines;
      patched.version = document.version;
      record.symbols = patched;
      return patched;
    }
  }

  record.symbols = buildSymbols(record.parse, schema, maxLines, Boolean(cached), document.version);
  return record.symbols;
}

export function getDocumentDerivedState(
  document: vscode.TextDocument,
  schema: HaproxySchema,
): Pick<DocumentSession, "analysis" | "modes" | "branches" | "hasLuaLoad" | "parse"> {
  const record = requireLiveRecord(document, schema);
  ensureSchemaIdentity(record, schema);
  return {
    parse: record.parse,
    analysis: ensureAnalysis(document, record, schema),
    modes: ensureModes(record, schema),
    branches: ensureBranches(record),
    hasLuaLoad: ensureLuaLoad(record),
  };
}

export function getDocumentAnalysis(
  document: vscode.TextDocument,
  schema: HaproxySchema,
): DocumentAnalysis {
  const record = requireLiveRecord(document, schema);
  ensureSchemaIdentity(record, schema);
  return ensureAnalysis(document, record, schema);
}

export function getDocumentSession(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxSymbolLines?: number,
): DocumentSession {
  const record = requireLiveRecord(document, schema);
  ensureSchemaIdentity(record, schema);
  const analysis = ensureAnalysis(document, record, schema);
  const modes = ensureModes(record, schema);
  const branches = ensureBranches(record);
  const hasLuaLoad = ensureLuaLoad(record);
  const maxLines = maxSymbolLines ?? document.lineCount;
  const symbols = ensureSymbols(document, record, schema, maxLines);
  return {
    document,
    schema,
    version: record.version,
    parse: record.parse,
    analysis,
    modes,
    branches,
    hasLuaLoad,
    symbols: symbols.index,
    symbolLineFingerprints: symbols.lineFingerprints,
  };
}

export function getSymbolIndex(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
): SymbolIndex | null {
  const record = requireLiveRecord(document, schema);
  ensureSchemaIdentity(record, schema);
  return ensureSymbols(document, record, schema, maxLines).index;
}

export function getSymbolIndexVersion(document: vscode.TextDocument): number | undefined {
  const sessions = liveSessionsForDocument(document);
  if (!sessions) {
    return undefined;
  }
  for (const record of sessions.values()) {
    if (record.symbols) {
      return record.symbols.version;
    }
  }
  return undefined;
}

export function hasUriSymbolIndexCache(document: vscode.TextDocument): boolean {
  const uriKey = normalizeUriKey(document.uri);
  return (
    hasUriSessionKey(uriKey) && uriSessionHasSymbols(uriKey, fingerprintText(document.getText()))
  );
}

export { clearDocumentSessions as clearSymbolIndexCaches };
