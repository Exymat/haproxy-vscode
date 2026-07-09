import * as vscode from "vscode";

import { documentContentFingerprint } from "../documentUriKey";
import { isHaproxyLanguageId } from "../grammar";
import { HaproxySchema } from "../schema";

import {
  aggregateDocuments,
  createDiskEntry,
  createOpenDocumentEntry,
  totalDocumentBytes,
  totalDocumentLines,
} from "./workspaceDocuments";
import {
  getDiscoveredUris,
  invalidateDiscoveryCache,
  targetFolderRefs,
  workspaceFolderForUri,
  workspaceFolderKey,
} from "./workspaceDiscovery";
import {
  WorkspaceDocumentSymbols,
  WorkspaceIndexChangeEvent,
  WorkspaceRebuildOptions,
  WorkspaceRebuildScope,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSettings,
} from "./workspaceTypes";
import { workspaceUriKey } from "./workspaceUri";

export { buildWorkspaceSymbolIndexFromOpenDocuments } from "./workspaceDocuments";
export { isUriExcludedFromWorkspaceSymbols } from "./workspaceDiscovery";
export {
  findAllWorkspaceSites,
  findWorkspaceDefinitions,
  findWorkspaceReferences,
  symbolIndexForWorkspaceDiagnostics,
  workspaceSiteRange,
  workspaceSiteText,
} from "./workspaceQueries";
export type {
  WorkspaceIndexChangeEvent,
  WorkspaceRebuildOptions,
  WorkspaceRebuildScope,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSettings,
  WorkspaceSymbolSite,
} from "./workspaceTypes";
export { workspaceUriKey } from "./workspaceUri";

let activeWorkspaceIndexes = new Map<string, WorkspaceSymbolIndex>();
let activeGeneration = 0;
let rebuildTimer: NodeJS.Timeout | undefined;
let activeSettings: WorkspaceSymbolSettings | null = null;
let activeSchema: HaproxySchema | null = null;
let activeMaxLines = 0;
let onDidChangeWorkspaceIndex: ((event: WorkspaceIndexChangeEvent) => void) | undefined;
const notifiedCappedFolders = new Set<string>();
const cappedFolderKeys = new Set<string>();

export function isDocumentWorkspaceIndexCapped(document: vscode.TextDocument): boolean {
  return cappedFolderKeys.has(workspaceFolderKey(workspaceFolderForUri(document.uri)));
}

export function hasCappedWorkspaceFolders(): boolean {
  return cappedFolderKeys.size > 0;
}

function notifyWorkspaceIndexCapped(): void {
  void vscode.window
    .showWarningMessage(
      "HAProxy workspace symbol index exceeded limits; cross-file navigation, rename, and missing-reference checks are disabled for this folder. Increase haproxy.workspaceSymbols.maxFiles, haproxy.workspaceSymbols.maxTotalLines, haproxy.workspaceSymbols.maxFileBytes, or haproxy.workspaceSymbols.maxTotalBytes.",
      "Open Settings",
    )
    .then((choice) => {
      if (choice === "Open Settings") {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@id:haproxy.workspaceSymbols.maxFiles",
        );
      }
    });
}

function updateCappedFolderTracking(
  folderKey: string,
  previousIndex: WorkspaceSymbolIndex | undefined,
  newIndex: WorkspaceSymbolIndex,
): void {
  if (newIndex.capped) {
    cappedFolderKeys.add(folderKey);
    if (!previousIndex?.capped && !notifiedCappedFolders.has(folderKey)) {
      notifiedCappedFolders.add(folderKey);
      notifyWorkspaceIndexCapped();
    }
    return;
  }
  cappedFolderKeys.delete(folderKey);
}

function setFolderWorkspaceIndex(
  folderKey: string,
  newIndex: WorkspaceSymbolIndex,
  indexes: Map<string, WorkspaceSymbolIndex> = activeWorkspaceIndexes,
): void {
  const previousIndex = indexes.get(folderKey);
  updateCappedFolderTracking(folderKey, previousIndex, newIndex);
  indexes.set(folderKey, newIndex);
}

function rebuildCappedFolderKeys(indexes: Map<string, WorkspaceSymbolIndex>): void {
  cappedFolderKeys.clear();
  for (const [folderKey, index] of indexes) {
    if (index.capped) {
      cappedFolderKeys.add(folderKey);
    }
  }
}

function limitExceeded(value: number, limit: number): boolean {
  return limit > 0 && value > limit;
}

function fileLimitReached(count: number, limit: number): boolean {
  return limit > 0 && count >= limit;
}

type ActiveWorkspaceRebuildScope = Exclude<WorkspaceRebuildScope, "none">;
type ActiveWorkspaceRebuildOptions = Omit<WorkspaceRebuildOptions, "scope"> & {
  scope?: ActiveWorkspaceRebuildScope;
};

interface PendingFolderTarget {
  forceRediscover: boolean;
  uri: vscode.Uri;
}

interface PendingRebuild {
  workspaceFull: boolean;
  workspaceContent: boolean;
  folderTargets: Map<string, PendingFolderTarget>;
  incrementalDocuments: Map<string, vscode.TextDocument>;
}

function createEmptyPendingRebuild(): PendingRebuild {
  return {
    workspaceFull: false,
    workspaceContent: false,
    folderTargets: new Map(),
    incrementalDocuments: new Map(),
  };
}

function removeIncrementalDocumentsInFolder(
  incrementalDocuments: Map<string, vscode.TextDocument>,
  folderKey: string,
): void {
  for (const [uriKey, document] of incrementalDocuments) {
    if (workspaceFolderKey(workspaceFolderForUri(document.uri)) === folderKey) {
      incrementalDocuments.delete(uriKey);
    }
  }
}

function mergePendingRebuild(
  current: PendingRebuild,
  options: ActiveWorkspaceRebuildOptions,
): PendingRebuild {
  const scope = options.scope ?? "full";

  if (scope === "full" && !options.document && !options.uri) {
    return { ...createEmptyPendingRebuild(), workspaceFull: true };
  }

  if (current.workspaceFull) {
    return current;
  }

  const next: PendingRebuild = {
    workspaceFull: false,
    workspaceContent: current.workspaceContent,
    folderTargets: new Map(current.folderTargets),
    incrementalDocuments: new Map(current.incrementalDocuments),
  };

  if (scope === "content" && !options.document && !options.uri) {
    return { ...createEmptyPendingRebuild(), workspaceContent: true };
  }

  if (scope === "incremental" && options.document) {
    const folderKey = workspaceFolderKey(workspaceFolderForUri(options.document.uri));
    const folderTarget = next.folderTargets.get(folderKey);
    if (folderTarget?.forceRediscover) {
      return next;
    }
    next.incrementalDocuments.set(workspaceUriKey(options.document.uri), options.document);
    return next;
  }

  const uri = options.uri ?? options.document?.uri;
  if (!uri) {
    return next;
  }

  const folderKey = workspaceFolderKey(workspaceFolderForUri(uri));
  const forceRediscover = scope === "full";
  if (forceRediscover) {
    removeIncrementalDocumentsInFolder(next.incrementalDocuments, folderKey);
  }
  const existing = next.folderTargets.get(folderKey);
  next.folderTargets.set(folderKey, {
    forceRediscover: forceRediscover || (existing?.forceRediscover ?? false),
    uri,
  });
  return next;
}

async function flushPendingRebuild(
  schema: HaproxySchema,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
  pending: PendingRebuild,
): Promise<void> {
  if (pending.workspaceFull) {
    await rebuildWorkspaceIndexes(schema, settings, maxLines, generation, { scope: "full" });
    return;
  }

  for (const document of pending.incrementalDocuments.values()) {
    /* v8 ignore start -- stale async generations are race guards for debounced flush work. */
    if (generation !== activeGeneration) {
      return;
    }
    /* v8 ignore stop */
    await rebuildWorkspaceIndexes(schema, settings, maxLines, generation, {
      scope: "incremental",
      document,
    });
  }

  if (pending.workspaceContent) {
    /* v8 ignore start -- stale async generations are race guards for debounced flush work. */
    if (generation !== activeGeneration) {
      return;
    }
    /* v8 ignore stop */
    await rebuildWorkspaceIndexes(schema, settings, maxLines, generation, { scope: "content" });
    return;
  }

  for (const target of pending.folderTargets.values()) {
    /* v8 ignore start -- stale async generations are race guards for debounced flush work. */
    if (generation !== activeGeneration) {
      return;
    }
    /* v8 ignore stop */
    await rebuildWorkspaceIndexes(schema, settings, maxLines, generation, {
      scope: target.forceRediscover ? "full" : "content",
      uri: target.uri,
    });
  }
}

let pendingRebuild = createEmptyPendingRebuild();

export function workspaceEntryForDocument(
  document: vscode.TextDocument,
): WorkspaceDocumentSymbols | undefined {
  const folderKey = workspaceFolderKey(workspaceFolderForUri(document.uri));
  return activeWorkspaceIndexes.get(folderKey)?.documents.get(workspaceUriKey(document.uri));
}

export function resolveWorkspaceRebuildScopeOnOpen(
  document: vscode.TextDocument,
): WorkspaceRebuildScope {
  if (!isHaproxyLanguageId(document.languageId)) {
    return "none";
  }

  const folderKey = workspaceFolderKey(workspaceFolderForUri(document.uri));
  const folderIndex = activeWorkspaceIndexes.get(folderKey);
  if (!folderIndex || folderIndex.capped) {
    return "full";
  }

  const uriKey = workspaceUriKey(document.uri);
  const entry = folderIndex.documents.get(uriKey);
  if (!entry) {
    return "full";
  }

  if (entry.fingerprint === documentContentFingerprint(document)) {
    return "none";
  }

  return "incremental";
}

export function isWorkspaceRebuildPending(): boolean {
  return rebuildTimer !== undefined;
}

function notifyWorkspaceIndexChanged(event: WorkspaceIndexChangeEvent): void {
  onDidChangeWorkspaceIndex?.(event);
}

async function buildFolderWorkspaceIndex(
  folder: vscode.WorkspaceFolder | undefined,
  folderKey: string,
  schema: HaproxySchema,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
  forceRediscover: boolean,
  previousDocuments: Map<string, WorkspaceDocumentSymbols>,
): Promise<WorkspaceSymbolIndex | null> {
  const uris = await getDiscoveredUris(settings, folder, folderKey, forceRediscover);
  /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
  if (generation !== activeGeneration) {
    return null;
  }
  /* v8 ignore stop */

  const documents = new Map<string, WorkspaceDocumentSymbols>();
  const byteLimits = {
    maxFileBytes: settings.maxFileBytes,
    maxLineBytes: settings.maxLineBytes,
  };
  let totalLines = 0;
  let totalBytes = 0;
  for (const uri of uris) {
    const uriKey = workspaceUriKey(uri);
    const entry = await createDiskEntry(
      uri,
      schema,
      maxLines,
      previousDocuments.get(uriKey),
      byteLimits,
    );
    /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
    if (generation !== activeGeneration) {
      return null;
    }
    /* v8 ignore stop */
    if (!entry) {
      continue;
    }
    if (fileLimitReached(documents.size, settings.maxFiles)) {
      return aggregateDocuments(generation, true, new Map());
    }
    totalLines += entry.parsed.length;
    if (limitExceeded(totalLines, settings.maxTotalLines)) {
      return aggregateDocuments(generation, true, new Map());
    }
    totalBytes += entry.byteLength;
    if (limitExceeded(totalBytes, settings.maxTotalBytes)) {
      return aggregateDocuments(generation, true, new Map());
    }
    documents.set(entry.uriKey, entry);
  }
  return aggregateDocuments(generation, false, documents);
}

async function updateSingleDocumentInWorkspaceIndex(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
): Promise<void> {
  const folder = workspaceFolderForUri(document.uri);
  const folderKey = workspaceFolderKey(folder);
  const existing = activeWorkspaceIndexes.get(folderKey);
  if (!existing || existing.capped) {
    await rebuildWorkspaceIndexes(schema, settings, maxLines, generation, {
      scope: "content",
    });
    return;
  }

  const uriKey = workspaceUriKey(document.uri);
  if (!existing.documents.has(uriKey)) {
    await rebuildWorkspaceIndexes(schema, settings, maxLines, generation, {
      scope: "full",
    });
    return;
  }

  const byteLimits = {
    maxFileBytes: settings.maxFileBytes,
    maxLineBytes: settings.maxLineBytes,
  };
  const entry = createOpenDocumentEntry(
    document,
    schema,
    maxLines,
    existing.documents.get(uriKey),
    byteLimits,
  );
  /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
  if (generation !== activeGeneration) {
    return;
  }
  /* v8 ignore stop */
  if (!entry) {
    const documents = new Map(existing.documents);
    documents.delete(uriKey);
    setFolderWorkspaceIndex(folderKey, aggregateDocuments(generation, false, documents));
    notifyWorkspaceIndexChanged({ scope: "incremental", document });
    return;
  }

  const documents = new Map(existing.documents);
  documents.set(entry.uriKey, entry);
  if (
    limitExceeded(totalDocumentLines(documents), settings.maxTotalLines) ||
    limitExceeded(totalDocumentBytes(documents), settings.maxTotalBytes)
  ) {
    setFolderWorkspaceIndex(folderKey, aggregateDocuments(generation, true, new Map()));
  } else {
    setFolderWorkspaceIndex(folderKey, aggregateDocuments(generation, false, documents));
  }
  notifyWorkspaceIndexChanged({ scope: "incremental", document });
}

async function rebuildWorkspaceIndexes(
  schema: HaproxySchema,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
  options: ActiveWorkspaceRebuildOptions = { scope: "full" },
): Promise<void> {
  if (!settings.enabled) {
    if (generation === activeGeneration) {
      activeWorkspaceIndexes = new Map();
      cappedFolderKeys.clear();
      invalidateDiscoveryCache();
      notifyWorkspaceIndexChanged({ scope: options.scope ?? "full", document: options.document });
    }
    return;
  }

  const scope = options.scope ?? "full";
  if (scope === "incremental" && options.document) {
    await updateSingleDocumentInWorkspaceIndex(
      options.document,
      schema,
      settings,
      maxLines,
      generation,
    );
    return;
  }

  const forceRediscover = scope === "full";
  if (forceRediscover) {
    invalidateDiscoveryCache();
  }

  const folderRefs = targetFolderRefs(options, activeWorkspaceIndexes.keys());
  const foldersToRebuild = new Set(folderRefs.map((ref) => ref.folderKey));
  const nextIndexes = new Map<string, WorkspaceSymbolIndex>();

  for (const [folderKey, index] of activeWorkspaceIndexes) {
    if (!foldersToRebuild.has(folderKey)) {
      nextIndexes.set(folderKey, { ...index, generation });
    }
  }

  for (const { folder, folderKey } of folderRefs) {
    const previousDocuments =
      activeWorkspaceIndexes.get(folderKey)?.documents ??
      new Map<string, WorkspaceDocumentSymbols>();
    const index = await buildFolderWorkspaceIndex(
      folder,
      folderKey,
      schema,
      settings,
      maxLines,
      generation,
      forceRediscover,
      previousDocuments,
    );
    /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
    if (generation !== activeGeneration || index === null) {
      return;
    }
    /* v8 ignore stop */
    const previousIndex = activeWorkspaceIndexes.get(folderKey);
    updateCappedFolderTracking(folderKey, previousIndex, index);
    nextIndexes.set(folderKey, index);
  }

  /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
  if (generation !== activeGeneration) {
    return;
  }
  /* v8 ignore stop */
  activeWorkspaceIndexes = nextIndexes;
  rebuildCappedFolderKeys(activeWorkspaceIndexes);
  notifyWorkspaceIndexChanged({ scope, document: options.document });
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
  options: WorkspaceRebuildOptions = { scope: "full" },
): void {
  const scope = options.scope ?? "full";
  if (scope === "none") {
    return;
  }

  activeSchema = schema;
  activeSettings = settings;
  activeMaxLines = maxLines;
  pendingRebuild = mergePendingRebuild(pendingRebuild, {
    scope,
    document: options.document,
    uri: options.uri,
  });
  activeGeneration += 1;
  const generation = activeGeneration;
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    const rebuildWork = pendingRebuild;
    pendingRebuild = createEmptyPendingRebuild();
    void flushPendingRebuild(schema, settings, maxLines, generation, rebuildWork);
  }, settings.debounceMs);
}

export function refreshWorkspaceSymbolIndexNow(): void {
  if (!activeSchema || !activeSettings) {
    return;
  }
  scheduleWorkspaceSymbolIndexRebuild(activeSchema, activeSettings, activeMaxLines, {
    scope: "full",
  });
}

export function clearWorkspaceSymbolIndex(): void {
  activeGeneration += 1;
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = undefined;
  }
  activeWorkspaceIndexes = new Map();
  cappedFolderKeys.clear();
  notifiedCappedFolders.clear();
  activeSettings = null;
  activeSchema = null;
  activeMaxLines = 0;
  pendingRebuild = createEmptyPendingRebuild();
  invalidateDiscoveryCache();
}

export function setWorkspaceSymbolIndexChangeListener(
  listener: ((event: WorkspaceIndexChangeEvent) => void) | undefined,
): void {
  onDidChangeWorkspaceIndex = listener;
}
