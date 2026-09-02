/** Loads and aggregates per-document symbol data for the workspace index. */
import * as vscode from "vscode";

import { fingerprintText } from "../core/contentFingerprint";
import { normalizeUriKey } from "../core/uriKey";
import { isHaproxyLanguageId } from "../extension/grammar";
import { getParsedDocumentEntry } from "../parser/parseCache";
import { parseDocumentLines, ParsedLine, tokenizeLine } from "../parser";
import { HaproxySchema } from "../schema/types";
import { sectionHeaderSet } from "../schema/layout";

import { buildSymbolIndex } from "./build";
import { getSymbolIndex } from "./cache";
import { buildReferencesByKey, sameSymbolGraph } from "./utils";
import { SymbolKind, SymbolSite } from "./types";
import { bumpWorkspaceContentRevision } from "./workspaceState";
import { WorkspaceEntrySkipReason } from "../extension/outputChannel";
import {
  SectionRange,
  WorkspaceDocumentSymbols,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSite,
} from "./workspaceTypes";
import { workspaceUriKey } from "./workspaceUri";

export interface WorkspaceEntryLoadResult {
  entry: WorkspaceDocumentSymbols | null;
  skipReason?: WorkspaceEntrySkipReason;
  readFailure?: {
    uri: vscode.Uri;
    code: string;
  };
}

export interface WorkspaceIndexByteLimits {
  maxFileBytes: number;
  maxLineBytes: number;
}

export function defaultWorkspaceIndexByteLimits(): WorkspaceIndexByteLimits {
  return {
    maxFileBytes: Number.POSITIVE_INFINITY,
    maxLineBytes: Number.POSITIVE_INFINITY,
  };
}

const textEncoder = new TextEncoder();
const workspaceEntrySchema = new WeakMap<WorkspaceDocumentSymbols, HaproxySchema>();
const HAPROXY_PREAMBLE_DIRECTIVES = new Set([
  ".if",
  ".elif",
  ".else",
  ".endif",
  ".diag",
  ".notice",
  ".warning",
  ".alert",
]);

export function encodedTextByteLength(text: string): number {
  return textEncoder.encode(text).length;
}

function exceedsLimit(value: number, limit: number): boolean {
  return limit > 0 && value > limit;
}

function lineExceedsMaxBytes(lines: string[], maxLineBytes: number): boolean {
  if (!(maxLineBytes > 0) || !Number.isFinite(maxLineBytes)) {
    return false;
  }
  for (const line of lines) {
    if (line.length > maxLineBytes) {
      return true;
    }
    if (line.length * 4 <= maxLineBytes) {
      continue;
    }
    if (exceedsLimit(encodedTextByteLength(line), maxLineBytes)) {
      return true;
    }
  }
  return false;
}

export function sameLineTexts(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function firstTokensFromParsed(parsed: ParsedLine[]): string[] {
  return parsed.map((line) => line.tokens[0]?.text ?? "");
}

function sectionRanges(parsed: ParsedLine[], lineTexts: string[]): Map<number, SectionRange> {
  const starts = parsed.filter((line) => line.isSectionHeader).map((line) => line.line);
  const ranges = new Map<number, SectionRange>();
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const nextStart = starts[i + 1];
    const endLine = nextStart === undefined ? parsed.length - 1 : nextStart - 1;
    ranges.set(start, {
      endLine,
      endColumn: lineTexts[endLine]?.length ?? 0,
      headerKeyword: parsed[start]?.tokens[0]?.text ?? "",
    });
  }
  return ranges;
}

function siteWithUri(site: SymbolSite, uri: vscode.Uri): WorkspaceSymbolSite {
  return { ...site, uri, uriKey: workspaceUriKey(uri) };
}

export function aggregateDocuments(
  generation: number,
  capped: boolean,
  documents: Map<string, WorkspaceDocumentSymbols>,
): WorkspaceSymbolIndex {
  const definitions = new Map<string, WorkspaceSymbolSite[]>();
  const references: WorkspaceSymbolSite[] = [];
  let scopedSymbolKinds: Set<SymbolKind> | undefined;

  for (const entry of documents.values()) {
    scopedSymbolKinds = entry.index.scopedSymbolKinds;
    for (const [key, defs] of entry.index.definitions) {
      const list = definitions.get(key) ?? [];
      for (const site of defs) {
        list.push(siteWithUri(site, entry.uri));
      }
      definitions.set(key, list);
    }
    for (const site of entry.index.references) {
      references.push(siteWithUri(site, entry.uri));
    }
  }

  const scoped = scopedSymbolKinds ?? new Set<SymbolKind>();
  return {
    generation,
    revision: bumpWorkspaceContentRevision(),
    capped,
    documents,
    definitions,
    references,
    referencesByKey: buildReferencesByKey(scoped, references),
    scopedSymbolKinds: scoped,
  };
}

function diskStatKey(stat: vscode.FileStat): string {
  return `${stat.mtime}:${stat.size}`;
}

function openDocumentForUri(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = normalizeUriKey(uri);
  return vscode.workspace.textDocuments.find((document) => normalizeUriKey(document.uri) === key);
}

export function looksLikeHaproxyConfig(
  lines: string[],
  sectionHeaders: ReadonlySet<string>,
): boolean {
  for (const line of lines) {
    const tokens = tokenizeLine(line);
    if (tokens.length === 0) {
      continue;
    }
    const first = tokens[0]?.text.toLowerCase();
    if (first !== undefined && HAPROXY_PREAMBLE_DIRECTIVES.has(first)) {
      continue;
    }
    return first !== undefined && sectionHeaders.has(first);
  }
  return false;
}

function skipEntry(reason: WorkspaceEntrySkipReason): WorkspaceEntryLoadResult {
  return { entry: null, skipReason: reason };
}

function entryHasSchemaIdentity(
  cached: WorkspaceDocumentSymbols | undefined,
  schema: HaproxySchema,
): cached is WorkspaceDocumentSymbols {
  return cached !== undefined && workspaceEntrySchema.get(cached) === schema;
}

function entryForSchema(
  entry: WorkspaceDocumentSymbols,
  schema: HaproxySchema,
): WorkspaceDocumentSymbols {
  workspaceEntrySchema.set(entry, schema);
  return entry;
}

export function createOpenDocumentEntry(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
  cached?: WorkspaceDocumentSymbols,
  limits: WorkspaceIndexByteLimits = defaultWorkspaceIndexByteLimits(),
): WorkspaceEntryLoadResult {
  if (!isHaproxyLanguageId(document.languageId)) {
    return skipEntry("unsupported-language");
  }
  if (document.lineCount > maxLines) {
    return skipEntry("too-many-lines");
  }
  const parse = getParsedDocumentEntry(document, { sectionHeaders: sectionHeaderSet(schema) });
  const lines = parse.lineTexts;
  const parsed = parse.parsed;
  if (lineExceedsMaxBytes(lines, limits.maxLineBytes)) {
    return skipEntry("line-too-long");
  }
  const headers = sectionHeaderSet(schema);
  if (!looksLikeHaproxyConfig(lines, headers)) {
    return skipEntry("not-haproxy-config");
  }
  const byteLength =
    cached && sameLineTexts(cached.lineTexts, lines)
      ? cached.byteLength
      : encodedTextByteLength(document.getText());
  if (exceedsLimit(byteLength, limits.maxFileBytes)) {
    return skipEntry("file-too-large");
  }
  const fingerprint =
    cached && sameLineTexts(cached.lineTexts, lines)
      ? cached.fingerprint
      : `open:${document.version}`;
  if (entryHasSchemaIdentity(cached, schema) && sameLineTexts(cached.lineTexts, lines)) {
    return {
      entry: entryForSchema(
        {
          ...cached,
          uri: document.uri,
          uriKey: workspaceUriKey(document.uri),
          version: document.version,
          fingerprint,
          diskStatKey: null,
          byteLength,
        },
        schema,
      ),
    };
  }
  const index = getSymbolIndex(document, schema, maxLines);
  if (!index) {
    return skipEntry("too-many-lines");
  }
  const tokens = firstTokensFromParsed(parsed);
  if (entryHasSchemaIdentity(cached, schema) && sameSymbolGraph(cached.index, index)) {
    return {
      entry: entryForSchema(
        {
          ...cached,
          uri: document.uri,
          uriKey: workspaceUriKey(document.uri),
          version: document.version,
          fingerprint,
          diskStatKey: null,
          byteLength,
          lineCount: parsed.length,
          lineTexts: lines,
          firstTokens: tokens,
          index,
        },
        schema,
      ),
    };
  }
  return {
    entry: entryForSchema(
      {
        uri: document.uri,
        uriKey: workspaceUriKey(document.uri),
        version: document.version,
        fingerprint,
        diskStatKey: null,
        byteLength,
        lineCount: parsed.length,
        lineTexts: lines,
        firstTokens: tokens,
        index,
        sectionRangesByStartLine: sectionRanges(parsed, lines),
      },
      schema,
    ),
  };
}

export function buildWorkspaceSymbolIndexFromOpenDocuments(
  documents: readonly vscode.TextDocument[],
  schema: HaproxySchema,
  maxLines: number,
  limits: WorkspaceIndexByteLimits = defaultWorkspaceIndexByteLimits(),
): WorkspaceSymbolIndex {
  const entries = new Map<string, WorkspaceDocumentSymbols>();
  for (const document of documents) {
    const { entry } = createOpenDocumentEntry(document, schema, maxLines, undefined, limits);
    if (entry) {
      entries.set(entry.uriKey, entry);
    }
  }
  return aggregateDocuments(0, false, entries);
}

export async function loadDiskEntry(
  uri: vscode.Uri,
  schema: HaproxySchema,
  maxLines: number,
  cached?: WorkspaceDocumentSymbols,
  limits: WorkspaceIndexByteLimits = defaultWorkspaceIndexByteLimits(),
): Promise<WorkspaceEntryLoadResult> {
  const open = openDocumentForUri(uri);
  if (open) {
    return createOpenDocumentEntry(open, schema, maxLines, cached, limits);
  }

  try {
    const stat = await vscode.workspace.fs.stat(uri);
    const statKey = diskStatKey(stat);
    if (exceedsLimit(stat.size, limits.maxFileBytes)) {
      return skipEntry("file-too-large");
    }

    if (
      entryHasSchemaIdentity(cached, schema) &&
      cached.diskStatKey === statKey &&
      cached.version === null
    ) {
      return { entry: cached };
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder("utf-8").decode(bytes);
    const byteLength = bytes.byteLength;
    const lines = text.split(/\r?\n/);
    if (lines.length > maxLines) {
      return skipEntry("too-many-lines");
    }
    if (lineExceedsMaxBytes(lines, limits.maxLineBytes)) {
      return skipEntry("line-too-long");
    }
    const headers = sectionHeaderSet(schema);
    if (!looksLikeHaproxyConfig(lines, headers)) {
      return skipEntry("not-haproxy-config");
    }
    const parsed = parseDocumentLines(lines, { sectionHeaders: headers });
    const index = buildSymbolIndex(parsed, schema);
    return {
      entry: entryForSchema(
        {
          uri,
          uriKey: workspaceUriKey(uri),
          version: null,
          fingerprint: fingerprintText(text),
          diskStatKey: statKey,
          byteLength,
          lineCount: parsed.length,
          lineTexts: lines,
          firstTokens: firstTokensFromParsed(parsed),
          index,
          sectionRangesByStartLine: sectionRanges(parsed, lines),
        },
        schema,
      ),
    };
  } catch (error) {
    if (error instanceof vscode.FileSystemError) {
      return {
        entry: null,
        skipReason: "read-failed",
        readFailure: {
          uri,
          code: error.code,
        },
      };
    }
    return skipEntry("read-failed");
  }
}

export async function createDiskEntry(
  uri: vscode.Uri,
  schema: HaproxySchema,
  maxLines: number,
  cached?: WorkspaceDocumentSymbols,
  limits: WorkspaceIndexByteLimits = defaultWorkspaceIndexByteLimits(),
): Promise<WorkspaceDocumentSymbols | null> {
  const { entry } = await loadDiskEntry(uri, schema, maxLines, cached, limits);
  return entry;
}

export function totalDocumentLines(documents: Map<string, WorkspaceDocumentSymbols>): number {
  let totalLines = 0;
  for (const entry of documents.values()) {
    totalLines += entry.lineCount;
  }
  return totalLines;
}

export function totalDocumentBytes(documents: Map<string, WorkspaceDocumentSymbols>): number {
  let totalBytes = 0;
  for (const entry of documents.values()) {
    totalBytes += entry.byteLength;
  }
  return totalBytes;
}
