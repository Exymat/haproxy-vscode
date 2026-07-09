import * as vscode from "vscode";

import { isHaproxyLanguageId } from "../grammar";

import { FolderRef, WorkspaceRebuildOptions, WorkspaceSymbolSettings } from "./workspaceTypes";
import { workspaceUriKey } from "./workspaceUri";

export const GLOBAL_WORKSPACE_FOLDER_KEY = "<global>";

interface DiscoveryCacheEntry {
  settingsKey: string;
  uris: vscode.Uri[];
}

const discoveryCache = new Map<string, DiscoveryCacheEntry>();

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
  return `{${settings.exclude.join(",")}}`;
}

function relativePattern(
  folder: vscode.WorkspaceFolder | undefined,
  pattern: string,
): vscode.GlobPattern {
  return folder ? new vscode.RelativePattern(folder, pattern) : pattern;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globPatternToRegExp(pattern: string): RegExp {
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
    source += escapeRegExp(ch);
  }
  return new RegExp(`^${source}$`, "i");
}

function expandBracePattern(pattern: string): string[] {
  if (!pattern.startsWith("{") || !pattern.endsWith("}")) {
    return [pattern];
  }
  return pattern.slice(1, -1).split(",");
}

function globMatches(pattern: string, value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return expandBracePattern(pattern).some((part) => globPatternToRegExp(part).test(normalized));
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
  return settings.exclude.some((pattern) => globMatches(pattern, rel));
}

async function discoverUris(
  settings: WorkspaceSymbolSettings,
  folder: vscode.WorkspaceFolder | undefined,
): Promise<vscode.Uri[]> {
  const discovered = new Map<string, vscode.Uri>();
  const exclude = excludePattern(settings);
  for (const include of settings.include) {
    const uris = await vscode.workspace.findFiles(
      relativePattern(folder, include),
      exclude ? relativePattern(folder, exclude) : undefined,
    );
    for (const uri of uris) {
      discovered.set(workspaceUriKey(uri), uri);
    }
  }
  return [...discovered.values()];
}

export async function getDiscoveredUris(
  settings: WorkspaceSymbolSettings,
  folder: vscode.WorkspaceFolder | undefined,
  folderKey: string,
  forceRediscover: boolean,
): Promise<vscode.Uri[]> {
  const settingsKey = discoverySettingsKey(settings, folderKey);
  const cached = discoveryCache.get(folderKey);
  if (!forceRediscover && cached && cached.settingsKey === settingsKey) {
    return cached.uris;
  }
  const uris = await discoverUris(settings, folder);
  discoveryCache.set(folderKey, { settingsKey, uris });
  return uris;
}
