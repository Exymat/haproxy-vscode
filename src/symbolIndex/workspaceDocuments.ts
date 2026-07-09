import * as vscode from "vscode";

import { fingerprintText } from "../contentFingerprint";
import { isHaproxyLanguageId } from "../grammar";
import { getParsedDocument } from "../parseCache";
import { parseDocumentLines, ParsedLine } from "../parser";
import { HaproxySchema, sectionHeaderSet } from "../schema";

import { buildSymbolIndex } from "./build";
import { getSymbolIndex } from "./cache";
import { buildReferencesByKey } from "./utils";
import { SymbolKind, SymbolSite } from "./types";
import {
  SectionRange,
  WorkspaceDocumentSymbols,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSite,
} from "./workspaceTypes";
import { workspaceUriKey } from "./workspaceUri";

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

export function encodedTextByteLength(text: string): number {
  return textEncoder.encode(text).length;
}

function exceedsLimit(value: number, limit: number): boolean {
  return limit > 0 && value > limit;
}

function lineExceedsMaxBytes(lines: string[], maxLineBytes: number): boolean {
  for (const line of lines) {
    if (exceedsLimit(encodedTextByteLength(line), maxLineBytes)) {
      return true;
    }
  }
  return false;
}

function textDocumentContent(document: vscode.TextDocument): { text: string; lines: string[] } {
  const text = document.getText();
  return { text, lines: text.split(/\r?\n/) };
}

function diskStatKey(stat: vscode.FileStat): string {
  return `${stat.mtime}:${stat.size}`;
}

function logDiskReadFailure(uri: vscode.Uri, error: unknown): void {
  if (error instanceof vscode.FileSystemError) {
    console.debug(`createDiskEntry disk read failed (${error.code}): ${workspaceUriKey(uri)}`);
  }
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
    capped,
    documents,
    definitions,
    references,
    referencesByKey: buildReferencesByKey(scoped, references),
    scopedSymbolKinds: scoped,
  };
}

function openDocumentForUri(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = workspaceUriKey(uri);
  return vscode.workspace.textDocuments.find((document) => workspaceUriKey(document.uri) === key);
}

export function looksLikeHaproxyConfig(
  lines: string[],
  sectionHeaders: ReadonlySet<string>,
): boolean {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const first = trimmed.split(/\s+/)[0]?.toLowerCase();
    return first !== undefined && sectionHeaders.has(first);
  }
  return false;
}

export function createOpenDocumentEntry(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
  cached?: WorkspaceDocumentSymbols,
  limits: WorkspaceIndexByteLimits = defaultWorkspaceIndexByteLimits(),
): WorkspaceDocumentSymbols | null {
  if (!isHaproxyLanguageId(document.languageId) || document.lineCount > maxLines) {
    return null;
  }
  const { text, lines } = textDocumentContent(document);
  if (exceedsLimit(encodedTextByteLength(text), limits.maxFileBytes)) {
    return null;
  }
  if (lineExceedsMaxBytes(lines, limits.maxLineBytes)) {
    return null;
  }
  const headers = sectionHeaderSet(schema);
  if (!looksLikeHaproxyConfig(lines, headers)) {
    return null;
  }
  const fingerprint = fingerprintText(text);
  const byteLength = encodedTextByteLength(text);
  if (cached && cached.fingerprint === fingerprint) {
    return {
      ...cached,
      uri: document.uri,
      uriKey: workspaceUriKey(document.uri),
      version: document.version,
      fingerprint,
      diskStatKey: null,
      byteLength,
    };
  }
  const index = getSymbolIndex(document, schema, maxLines)!;
  const parsed = getParsedDocument(document, { sectionHeaders: sectionHeaderSet(schema) });
  return {
    uri: document.uri,
    uriKey: workspaceUriKey(document.uri),
    version: document.version,
    fingerprint,
    diskStatKey: null,
    byteLength,
    parsed,
    lineTexts: lines,
    index,
    sectionRangesByStartLine: sectionRanges(parsed, lines),
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
    const entry = createOpenDocumentEntry(document, schema, maxLines, undefined, limits);
    if (entry) {
      entries.set(entry.uriKey, entry);
    }
  }
  return aggregateDocuments(0, false, entries);
}

export async function createDiskEntry(
  uri: vscode.Uri,
  schema: HaproxySchema,
  maxLines: number,
  cached?: WorkspaceDocumentSymbols,
  limits: WorkspaceIndexByteLimits = defaultWorkspaceIndexByteLimits(),
): Promise<WorkspaceDocumentSymbols | null> {
  const open = openDocumentForUri(uri);
  if (open) {
    return createOpenDocumentEntry(open, schema, maxLines, cached, limits);
  }

  try {
    const stat = await vscode.workspace.fs.stat(uri);
    const statKey = diskStatKey(stat);
    if (cached && cached.diskStatKey === statKey && cached.version === null) {
      return cached;
    }

    if (exceedsLimit(stat.size, limits.maxFileBytes)) {
      return null;
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder("utf-8").decode(bytes);
    const byteLength = bytes.byteLength;
    const lines = text.split(/\r?\n/);
    if (lines.length > maxLines) {
      return null;
    }
    if (lineExceedsMaxBytes(lines, limits.maxLineBytes)) {
      return null;
    }
    const headers = sectionHeaderSet(schema);
    if (!looksLikeHaproxyConfig(lines, headers)) {
      return null;
    }
    const parsed = parseDocumentLines(lines, { sectionHeaders: headers });
    const index = buildSymbolIndex(parsed, schema);
    return {
      uri,
      uriKey: workspaceUriKey(uri),
      version: null,
      fingerprint: fingerprintText(text),
      diskStatKey: statKey,
      byteLength,
      parsed,
      lineTexts: lines,
      index,
      sectionRangesByStartLine: sectionRanges(parsed, lines),
    };
  } catch (error) {
    logDiskReadFailure(uri, error);
    return null;
  }
}

export function totalDocumentLines(documents: Map<string, WorkspaceDocumentSymbols>): number {
  let totalLines = 0;
  for (const entry of documents.values()) {
    totalLines += entry.parsed.length;
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
