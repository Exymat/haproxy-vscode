import * as vscode from "vscode";

import { getParsedDocument } from "../parseCache";
import { parseDocumentLines, ParsedLine } from "../parser";
import { HaproxySchema, sectionHeaderSet } from "../schema";

import { buildSymbolIndex } from "./build";
import { getSymbolIndex } from "./cache";
import { buildReferencesByKey } from "./utils";
import { SymbolIndex, SymbolKind, symbolKeyForScopedKinds, SymbolSite } from "./types";

export interface WorkspaceSymbolSettings {
  enabled: boolean;
  include: string[];
  exclude: string[];
  maxFiles: number;
  maxTotalLines: number;
  debounceMs: number;
}

export interface WorkspaceSymbolSite extends SymbolSite {
  uri: vscode.Uri;
  uriKey: string;
}

interface SectionRange {
  endLine: number;
  endColumn: number;
}

interface WorkspaceDocumentSymbols {
  uri: vscode.Uri;
  uriKey: string;
  version: number | null;
  fingerprint: string;
  parsed: ParsedLine[];
  lineTexts: string[];
  index: SymbolIndex;
  sectionRangesByStartLine: Map<number, SectionRange>;
}

export interface WorkspaceSymbolIndex {
  generation: number;
  capped: boolean;
  documents: Map<string, WorkspaceDocumentSymbols>;
  definitions: Map<string, WorkspaceSymbolSite[]>;
  references: WorkspaceSymbolSite[];
  referencesByKey: Map<string, WorkspaceSymbolSite[]>;
  scopedSymbolKinds: Set<SymbolKind>;
}

const GLOBAL_WORKSPACE_FOLDER_KEY = "<global>";

let activeWorkspaceIndexes = new Map<string, WorkspaceSymbolIndex>();
let activeGeneration = 0;
let rebuildTimer: NodeJS.Timeout | undefined;
let activeSettings: WorkspaceSymbolSettings | null = null;
let activeSchema: HaproxySchema | null = null;
let activeMaxLines = 0;
let onDidChangeWorkspaceIndex: (() => void) | undefined;

export function workspaceUriKey(uri: vscode.Uri): string {
  const value = uri.toString();
  const isFileUri = uri.scheme === "file" || value.toLowerCase().startsWith("file:");
  if (!isFileUri) {
    return value;
  }
  const fsPath = uri.fsPath ?? "";
  const isWindowsFileUri =
    process.platform === "win32" ||
    /^[a-z]:[\\/]/i.test(fsPath) ||
    /^file:\/\/\/[a-z]%3a/i.test(value);
  return isWindowsFileUri ? value.toLowerCase() : value;
}

function textDocumentContent(document: vscode.TextDocument): { text: string; lines: string[] } {
  const text = document.getText();
  return { text, lines: text.split(/\r?\n/) };
}

function fingerprintText(text: string): string {
  return `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`;
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

function aggregateDocuments(
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

function workspaceFolderKey(folder: vscode.WorkspaceFolder | undefined): string {
  return folder ? workspaceUriKey(folder.uri) : GLOBAL_WORKSPACE_FOLDER_KEY;
}

function workspaceFolderForUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder?.(uri);
}

function activeWorkspaceFolders(): Array<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return [undefined];
  }

  const active = new Map<string, vscode.WorkspaceFolder>();
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId !== "haproxy") {
      continue;
    }
    const folder = workspaceFolderForUri(document.uri);
    if (folder) {
      active.set(workspaceFolderKey(folder), folder);
    }
  }
  return [...active.values()];
}

function createOpenDocumentEntry(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
): WorkspaceDocumentSymbols | null {
  if (document.languageId !== "haproxy" || document.lineCount > maxLines) {
    return null;
  }
  const index = getSymbolIndex(document, schema, maxLines);
  if (!index) {
    /* v8 ignore next -- line-count caps are checked before calling getSymbolIndex here. */
    return null;
  }
  const parsed = getParsedDocument(document, { sectionHeaders: sectionHeaderSet(schema) });
  const { text, lines } = textDocumentContent(document);
  return {
    uri: document.uri,
    uriKey: workspaceUriKey(document.uri),
    version: document.version,
    fingerprint: fingerprintText(text),
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
): WorkspaceSymbolIndex {
  const entries = new Map<string, WorkspaceDocumentSymbols>();
  for (const document of documents) {
    const entry = createOpenDocumentEntry(document, schema, maxLines);
    if (entry) {
      entries.set(entry.uriKey, entry);
    }
  }
  return aggregateDocuments(0, false, entries);
}

async function createDiskEntry(
  uri: vscode.Uri,
  schema: HaproxySchema,
  maxLines: number,
): Promise<WorkspaceDocumentSymbols | null> {
  const open = openDocumentForUri(uri);
  if (open) {
    return createOpenDocumentEntry(open, schema, maxLines);
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder("utf-8").decode(bytes);
  const lines = text.split(/\r?\n/);
  if (lines.length > maxLines) {
    return null;
  }
  const parsed = parseDocumentLines(lines, { sectionHeaders: sectionHeaderSet(schema) });
  const index = buildSymbolIndex(parsed, schema);
  return {
    uri,
    uriKey: workspaceUriKey(uri),
    version: null,
    fingerprint: fingerprintText(text),
    parsed,
    lineTexts: lines,
    index,
    sectionRangesByStartLine: sectionRanges(parsed, lines),
  };
}

function excludePattern(settings: WorkspaceSymbolSettings): string | undefined {
  if (settings.exclude.length === 0) {
    return undefined;
  }
  return `{${settings.exclude.join(",")}}`;
}

function relativePattern(
  folder: vscode.WorkspaceFolder | undefined,
  pattern: string,
): vscode.GlobPattern {
  return folder ? new vscode.RelativePattern(folder, pattern) : pattern;
}

async function discoverUris(
  settings: WorkspaceSymbolSettings,
  folder: vscode.WorkspaceFolder | undefined,
): Promise<vscode.Uri[] | null> {
  const discovered = new Map<string, vscode.Uri>();
  const exclude = excludePattern(settings);
  for (const include of settings.include) {
    const uris = await vscode.workspace.findFiles(
      relativePattern(folder, include),
      exclude ? relativePattern(folder, exclude) : undefined,
      settings.maxFiles + 1,
    );
    for (const uri of uris) {
      discovered.set(workspaceUriKey(uri), uri);
      if (discovered.size > settings.maxFiles) {
        return null;
      }
    }
  }
  return [...discovered.values()];
}

async function rebuildWorkspaceIndexes(
  schema: HaproxySchema,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
): Promise<void> {
  if (!settings.enabled) {
    if (generation === activeGeneration) {
      activeWorkspaceIndexes = new Map();
      onDidChangeWorkspaceIndex?.();
    }
    return;
  }

  const nextIndexes = new Map<string, WorkspaceSymbolIndex>();
  for (const folder of activeWorkspaceFolders()) {
    const folderKey = workspaceFolderKey(folder);
    const uris = await discoverUris(settings, folder);
    /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
    if (generation !== activeGeneration) {
      return;
    }
    /* v8 ignore stop */
    if (!uris) {
      nextIndexes.set(folderKey, aggregateDocuments(generation, true, new Map()));
      continue;
    }

    const documents = new Map<string, WorkspaceDocumentSymbols>();
    let totalLines = 0;
    for (const uri of uris) {
      const entry = await createDiskEntry(uri, schema, maxLines);
      /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
      if (generation !== activeGeneration) {
        return;
      }
      /* v8 ignore stop */
      if (!entry) {
        continue;
      }
      totalLines += entry.parsed.length;
      if (totalLines > settings.maxTotalLines) {
        nextIndexes.set(folderKey, aggregateDocuments(generation, true, new Map()));
        break;
      }
      documents.set(entry.uriKey, entry);
    }
    if (!nextIndexes.has(folderKey)) {
      nextIndexes.set(folderKey, aggregateDocuments(generation, false, documents));
    }
  }

  /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
  if (generation !== activeGeneration) {
    return;
  }
  /* v8 ignore stop */
  activeWorkspaceIndexes = nextIndexes;
  onDidChangeWorkspaceIndex?.();
}

export function getWorkspaceSymbolIndex(
  document?: vscode.TextDocument,
): WorkspaceSymbolIndex | null {
  if (document) {
    const index = activeWorkspaceIndexes.get(
      workspaceFolderKey(workspaceFolderForUri(document.uri)),
    );
    return index?.capped ? null : (index ?? null);
  }

  if (activeWorkspaceIndexes.size !== 1) {
    return null;
  }
  const [index] = activeWorkspaceIndexes.values();
  return index?.capped ? null : index;
}

export function scheduleWorkspaceSymbolIndexRebuild(
  schema: HaproxySchema,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
): void {
  activeSchema = schema;
  activeSettings = settings;
  activeMaxLines = maxLines;
  activeGeneration += 1;
  const generation = activeGeneration;
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    void rebuildWorkspaceIndexes(schema, settings, maxLines, generation);
  }, settings.debounceMs);
}

export function refreshWorkspaceSymbolIndexNow(): void {
  if (!activeSchema || !activeSettings) {
    return;
  }
  scheduleWorkspaceSymbolIndexRebuild(activeSchema, activeSettings, activeMaxLines);
}

export function clearWorkspaceSymbolIndex(): void {
  activeGeneration += 1;
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = undefined;
  }
  activeWorkspaceIndexes = new Map();
  activeSettings = null;
  activeSchema = null;
  activeMaxLines = 0;
}

export function setWorkspaceSymbolIndexChangeListener(listener: (() => void) | undefined): void {
  onDidChangeWorkspaceIndex = listener;
}

export function findWorkspaceDefinitions(
  workspaceIndex: WorkspaceSymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): WorkspaceSymbolSite[] {
  const key = symbolKeyForScopedKinds(workspaceIndex.scopedSymbolKinds, kind, name, scopeKey);
  return workspaceIndex.definitions.get(key) ?? [];
}

export function findWorkspaceReferences(
  workspaceIndex: WorkspaceSymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): WorkspaceSymbolSite[] {
  const key = symbolKeyForScopedKinds(workspaceIndex.scopedSymbolKinds, kind, name, scopeKey);
  return workspaceIndex.referencesByKey.get(key) ?? [];
}

export function workspaceSiteRange(
  workspaceIndex: WorkspaceSymbolIndex,
  site: WorkspaceSymbolSite,
): SectionRange | undefined {
  return workspaceIndex.documents.get(site.uriKey)?.sectionRangesByStartLine.get(site.line);
}

export function workspaceSiteText(
  workspaceIndex: WorkspaceSymbolIndex,
  site: WorkspaceSymbolSite,
): string | undefined {
  const document = workspaceIndex.documents.get(site.uriKey);
  if (!document) {
    return undefined;
  }

  if (site.role !== "definition") {
    return document.lineTexts[site.line];
  }

  const range = workspaceSiteRange(workspaceIndex, site);
  if (!range) {
    return document.lineTexts[site.line];
  }

  return document.lineTexts.slice(site.line, range.endLine + 1).join("\n");
}

function localReferencesMissingInWorkspace(
  localIndex: SymbolIndex,
  workspaceIndex: WorkspaceSymbolIndex,
): SymbolSite[] {
  const unresolved: SymbolSite[] = [];
  for (const reference of localIndex.references) {
    const key = symbolKeyForScopedKinds(
      localIndex.scopedSymbolKinds,
      reference.kind,
      reference.name,
      reference.scopeKey,
    );
    if (!workspaceIndex.definitions.has(key)) {
      unresolved.push(reference);
    }
  }
  return unresolved;
}

export function symbolIndexForWorkspaceDiagnostics(
  document: vscode.TextDocument,
  localIndex: SymbolIndex,
  workspaceIndex: WorkspaceSymbolIndex | null,
): SymbolIndex {
  if (!workspaceIndex || !workspaceIndex.documents.has(workspaceUriKey(document.uri))) {
    return localIndex;
  }

  return {
    definitions: localIndex.definitions,
    references: localIndex.references,
    referencesByKey: workspaceIndex.referencesByKey,
    scopeKeyByLine: localIndex.scopeKeyByLine,
    scopedSymbolKinds: localIndex.scopedSymbolKinds,
    sitesByLine: localIndex.sitesByLine,
    unresolvedReferences: localReferencesMissingInWorkspace(localIndex, workspaceIndex),
  };
}
