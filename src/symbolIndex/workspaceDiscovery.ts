import * as vscode from "vscode";

import { isHaproxyLanguageId } from "../extension/grammar";

import { FolderRef, WorkspaceRebuildOptions, WorkspaceSymbolSettings } from "./workspaceTypes";
import { workspaceUriKey } from "./workspaceUri";

export const GLOBAL_WORKSPACE_FOLDER_KEY = "<global>";

interface DiscoveryCacheEntry {
  settingsKey: string;
  result: WorkspaceDiscoveryResult;
}

const discoveryCache = new Map<string, DiscoveryCacheEntry>();

export interface WorkspaceDiscoveryResult {
  uris: vscode.Uri[];
  capped: boolean;
}

export function workspaceFolderKey(folder: vscode.WorkspaceFolder | undefined): string {
  return folder ? workspaceUriKey(folder.uri) : GLOBAL_WORKSPACE_FOLDER_KEY;
}

export function workspaceFolderForUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder?.(uri);
}

function activeWorkspaceFolders(): Array<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return [undefined];
  }

  const active = new Map<string, vscode.WorkspaceFolder>();
  for (const document of vscode.workspace.textDocuments) {
    if (!isHaproxyLanguageId(document.languageId)) {
      continue;
    }
    const folder = workspaceFolderForUri(document.uri);
    if (folder) {
      active.set(workspaceFolderKey(folder), folder);
    }
  }
  return [...active.values()];
}

function folderRefForKey(folderKey: string): FolderRef | undefined {
  if (folderKey === GLOBAL_WORKSPACE_FOLDER_KEY) {
    return { folder: undefined, folderKey };
  }
  const folder = vscode.workspace.workspaceFolders?.find(
    (entry) => workspaceFolderKey(entry) === folderKey,
  );
  if (!folder) {
    return undefined;
  }
  return { folder, folderKey };
}

export function indexedWorkspaceFolders(activeFolderKeys: Iterable<string>): FolderRef[] {
  const refs = new Map<string, FolderRef>();

  for (const folderKey of activeFolderKeys) {
    const ref = folderRefForKey(folderKey);
    if (ref) {
      refs.set(folderKey, ref);
    }
  }

  for (const folder of activeWorkspaceFolders()) {
    const folderKey = workspaceFolderKey(folder);
    refs.set(folderKey, { folder, folderKey });
  }

  if (refs.size === 0) {
    return [{ folder: undefined, folderKey: GLOBAL_WORKSPACE_FOLDER_KEY }];
  }

  return [...refs.values()];
}

function folderRefForDocument(document: vscode.TextDocument): FolderRef {
  const folder = workspaceFolderForUri(document.uri);
  return { folder, folderKey: workspaceFolderKey(folder) };
}

function folderRefForUri(uri: vscode.Uri): FolderRef {
  const folder = workspaceFolderForUri(uri);
  return { folder, folderKey: workspaceFolderKey(folder) };
}

export function targetFolderRefs(
  options: WorkspaceRebuildOptions,
  activeFolderKeys: Iterable<string>,
): FolderRef[] {
  if (options.document) {
    return [folderRefForDocument(options.document)];
  }
  if (options.uri) {
    return [folderRefForUri(options.uri)];
  }
  return indexedWorkspaceFolders(activeFolderKeys);
}

function discoverySettingsKey(settings: WorkspaceSymbolSettings, folderKey: string): string {
  return JSON.stringify({
    folderKey,
    include: settings.include,
    exclude: settings.exclude,
    maxFiles: Number.isFinite(settings.maxFiles) ? settings.maxFiles : 0,
  });
}

export function invalidateDiscoveryCache(): void {
  discoveryCache.clear();
}

function excludePattern(settings: WorkspaceSymbolSettings): string | undefined {
  if (settings.exclude.length === 0) {
    return undefined;
  }
  const expanded = settings.exclude.flatMap((pattern) => expandBracePattern(pattern));
  return expanded.length === 1 ? expanded[0] : `{${expanded.join(",")}}`;
}

function relativePattern(
  folder: vscode.WorkspaceFolder | undefined,
  pattern: string,
): vscode.GlobPattern {
  return folder ? new vscode.RelativePattern(folder, pattern) : pattern;
}

function maxDiscoveryResults(settings: WorkspaceSymbolSettings): number | undefined {
  return Number.isFinite(settings.maxFiles) && settings.maxFiles > 0
    ? settings.maxFiles + 1
    : undefined;
}

async function findWorkspaceFiles(
  include: vscode.GlobPattern,
  exclude: vscode.GlobPattern | undefined,
  maxResults: number | undefined,
): Promise<vscode.Uri[]> {
  if (maxResults === undefined) {
    return vscode.workspace.findFiles(include, exclude);
  }
  return vscode.workspace.findFiles(include, exclude, maxResults);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function escapeRegExpCharacterClass(value: string): string {
  return value.replace(/[[\]\\^]/g, "\\$&");
}

function literalGlobBracket(pattern: string, openIndex: number, closeIndex: number): string {
  return escapeRegExp(pattern.slice(openIndex, closeIndex + 1));
}

function globBracketClassToRegExpSource(
  pattern: string,
  openIndex: number,
): { source: string; closeIndex: number } | undefined {
  const closeIndex = pattern.indexOf("]", openIndex + 1);
  if (closeIndex === -1) {
    return undefined;
  }

  const body = pattern.slice(openIndex + 1, closeIndex);
  const negated = body.startsWith("!");
  const classBody = negated ? body.slice(1) : body;
  if (classBody.length === 0) {
    return { source: literalGlobBracket(pattern, openIndex, closeIndex), closeIndex };
  }

  const escapedClassBody = escapeRegExpCharacterClass(classBody);
  const source = `(?!/)${negated ? `[^${escapedClassBody}]` : `[${escapedClassBody}]`}`;
  try {
    new RegExp(source);
  } catch {
    return { source: literalGlobBracket(pattern, openIndex, closeIndex), closeIndex };
  }
  return { source, closeIndex };
}

function globPatternToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let source = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === "*") {
      const next = normalized[i + 1];
      if (next === "*") {
        const after = normalized[i + 2];
        if (after === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
        continue;
      }
      source += "[^/]*";
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      continue;
    }
    if (ch === "[") {
      const bracket = globBracketClassToRegExpSource(normalized, i);
      if (bracket) {
        source += bracket.source;
        i = bracket.closeIndex;
        continue;
      }
    }
    source += escapeRegExp(ch);
  }
  return new RegExp(`^${source}$`, caseInsensitive ? "i" : "");
}

function expandBracePattern(pattern: string): string[] {
  const openIndex = pattern.indexOf("{");
  if (openIndex === -1) {
    return [pattern];
  }
  let depth = 0;
  let closeIndex = -1;
  for (let i = openIndex; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }
  if (closeIndex === -1) {
    return [pattern];
  }

  const body = pattern.slice(openIndex + 1, closeIndex);
  const alternatives: string[] = [];
  let start = 0;
  depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      alternatives.push(body.slice(start, i));
      start = i + 1;
    }
  }
  if (alternatives.length === 0) {
    return [pattern];
  }
  alternatives.push(body.slice(start));

  const prefix = pattern.slice(0, openIndex);
  const suffix = pattern.slice(closeIndex + 1);
  return alternatives.flatMap((alternative) =>
    expandBracePattern(`${prefix}${alternative}${suffix}`),
  );
}

function globMatches(pattern: string, value: string, caseInsensitive: boolean): boolean {
  const normalized = value.replace(/\\/g, "/");
  return expandBracePattern(pattern).some((part) =>
    globPatternToRegExp(part, caseInsensitive).test(normalized),
  );
}

function looksLikeWindowsPath(value: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(value) || /^file:\/\/\/[a-zA-Z]:\//.test(value) || /^\\\\/.test(value)
  );
}

function relativePathForUri(
  uri: vscode.Uri,
  folder: vscode.WorkspaceFolder | undefined,
): string | null {
  const fsPath = uri.fsPath;
  if (!fsPath) {
    return null;
  }
  const normalized = fsPath.replace(/\\/g, "/");
  if (!folder) {
    return normalized;
  }
  const base = (folder.uri.fsPath ?? folder.uri.toString()).replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const baseLower = base.toLowerCase();
  if (lower === baseLower) {
    return "";
  }
  if (!lower.startsWith(`${baseLower}/`)) {
    return null;
  }
  return normalized.slice(base.length + 1);
}

function isCaseInsensitivePath(
  uri: vscode.Uri,
  folder: vscode.WorkspaceFolder | undefined,
): boolean {
  const uriPath = uri.fsPath || uri.toString();
  const folderPath = folder ? (folder.uri.fsPath ?? folder.uri.toString()) : "";
  return looksLikeWindowsPath(uriPath) || looksLikeWindowsPath(folderPath);
}

export function isUriExcludedFromWorkspaceSymbols(
  uri: vscode.Uri,
  settings: WorkspaceSymbolSettings,
  folder?: vscode.WorkspaceFolder,
): boolean {
  if (settings.exclude.length === 0) {
    return false;
  }
  const rel = relativePathForUri(uri, folder);
  if (rel === null) {
    return false;
  }
  const caseInsensitive = isCaseInsensitivePath(uri, folder);
  return settings.exclude.some((pattern) => globMatches(pattern, rel, caseInsensitive));
}

async function discoverUris(
  settings: WorkspaceSymbolSettings,
  folder: vscode.WorkspaceFolder | undefined,
): Promise<WorkspaceDiscoveryResult> {
  const discovered = new Map<string, vscode.Uri>();
  const exclude = excludePattern(settings);
  const maxResults = maxDiscoveryResults(settings);
  const expectedFolderKey = folder ? workspaceFolderKey(folder) : undefined;
  for (const include of settings.include) {
    const uris = await findWorkspaceFiles(
      relativePattern(folder, include),
      exclude ? relativePattern(folder, exclude) : undefined,
      maxResults,
    );
    for (const uri of uris) {
      if (
        expectedFolderKey !== undefined &&
        workspaceFolderKey(workspaceFolderForUri(uri)) !== expectedFolderKey
      ) {
        continue;
      }
      discovered.set(workspaceUriKey(uri), uri);
      if (maxResults !== undefined && discovered.size >= maxResults) {
        return { uris: [...discovered.values()], capped: true };
      }
    }
  }
  return { uris: [...discovered.values()], capped: false };
}

export async function getDiscoveryResult(
  settings: WorkspaceSymbolSettings,
  folder: vscode.WorkspaceFolder | undefined,
  folderKey: string,
  forceRediscover: boolean,
): Promise<WorkspaceDiscoveryResult> {
  const settingsKey = discoverySettingsKey(settings, folderKey);
  const cached = discoveryCache.get(folderKey);
  if (!forceRediscover && cached && cached.settingsKey === settingsKey) {
    return cached.result;
  }
  const result = await discoverUris(settings, folder);
  discoveryCache.set(folderKey, { settingsKey, result });
  return result;
}

export async function getDiscoveredUris(
  settings: WorkspaceSymbolSettings,
  folder: vscode.WorkspaceFolder | undefined,
  folderKey: string,
  forceRediscover: boolean,
): Promise<vscode.Uri[]> {
  return (await getDiscoveryResult(settings, folder, folderKey, forceRediscover)).uris;
}
