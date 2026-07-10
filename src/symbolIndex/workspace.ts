import * as vscode from "vscode";

import { documentContentFingerprint } from "../documentUriKey";
import { isHaproxyLanguageId } from "../grammar";
import {
  logDiskEntryReadFailure,
  logWorkspaceIndexCompleted,
  logWorkspaceIndexDisabled,
  logWorkspaceIndexSchemaLoadFailed,
  logWorkspaceIndexStarted,
  WorkspaceEntrySkipReason,
} from "../outputChannel";
import { HaproxySchema } from "../schema";

import {
  aggregateDocuments,
  createOpenDocumentEntry,
  loadDiskEntry,
  WorkspaceEntryLoadResult,
  totalDocumentBytes,
  totalDocumentLines,
} from "./workspaceDocuments";
import {
  getDiscoveryResult,
  GLOBAL_WORKSPACE_FOLDER_KEY,
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

export type WorkspaceSchemaSource =
  HaproxySchema | ((folder: vscode.WorkspaceFolder | undefined) => Promise<HaproxySchema>);

function normalizeSchemaSource(
  source: WorkspaceSchemaSource,
): (folder: vscode.WorkspaceFolder | undefined) => Promise<HaproxySchema> {
  if (typeof source === "function") {
    return source;
  }
  return () => Promise.resolve(source);
}

let activeWorkspaceIndexes = new Map<string, WorkspaceSymbolIndex>();
let activeGeneration = 0;
let rebuildTimer: NodeJS.Timeout | undefined;
let activeSettings: WorkspaceSymbolSettings | null = null;
let activeSchemaSource: WorkspaceSchemaSource | null = null;
let activeMaxLines = 0;
let onDidChangeWorkspaceIndex: ((event: WorkspaceIndexChangeEvent) => void) | undefined;
const notifiedCappedFolders = new Set<string>();
const cappedFolderKeys = new Set<string>();
const FOREIGN_CFG_DISCOVERY_EXTRA = 100;
const DISK_ENTRY_LOAD_CONCURRENCY = 8;

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
  resolveSchema: (folder: vscode.WorkspaceFolder | undefined) => Promise<HaproxySchema>,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
  pending: PendingRebuild,
): Promise<void> {
  if (pending.workspaceFull) {
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, { scope: "full" });
    return;
  }

  for (const document of pending.incrementalDocuments.values()) {
    /* v8 ignore start -- stale async generations are race guards for debounced flush work. */
    if (generation !== activeGeneration) {
      return;
    }
    /* v8 ignore stop */
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
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
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: "content",
    });
    return;
  }

  for (const target of pending.folderTargets.values()) {
    /* v8 ignore start -- stale async generations are race guards for debounced flush work. */
    if (generation !== activeGeneration) {
      return;
    }
    /* v8 ignore stop */
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
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

function folderLabel(folder: vscode.WorkspaceFolder | undefined, folderKey: string): string {
  return (
    folder?.name ??
    folder?.uri.fsPath ??
    (folderKey === GLOBAL_WORKSPACE_FOLDER_KEY ? "global" : folderKey)
  );
}

function recordSkipReason(
  skipReasons: Partial<Record<WorkspaceEntrySkipReason, number>>,
  reason?: WorkspaceEntrySkipReason,
): void {
  if (!reason) {
    return;
  }
  skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
}

function hasSkipReasons(skipReasons: Partial<Record<WorkspaceEntrySkipReason, number>>): boolean {
  return Object.values(skipReasons).some((count) => (count ?? 0) > 0);
}

function logReadFailureIfPresent(result: WorkspaceEntryLoadResult): void {
  if (result.readFailure) {
    logDiskEntryReadFailure(result.readFailure.uri, result.readFailure.code);
  }
}

interface LoadedDiskEntry {
  result: WorkspaceEntryLoadResult;
}

async function* loadDiskEntriesInDiscoveryOrder(
  uris: readonly vscode.Uri[],
  schema: HaproxySchema,
  maxLines: number,
  previousDocuments: Map<string, WorkspaceDocumentSymbols>,
  byteLimits: { maxFileBytes: number; maxLineBytes: number },
  generation: number,
): AsyncGenerator<LoadedDiskEntry> {
  const concurrency = Math.min(DISK_ENTRY_LOAD_CONCURRENCY, uris.length);
  const results = new Map<number, WorkspaceEntryLoadResult>();
  const errors = new Map<number, unknown>();
  let nextToStart = 0;
  let nextToYield = 0;
  let activeLoads = 0;
  let stopped = false;
  let wake: (() => void) | undefined;

  const notify = () => {
    const pendingWake = wake;
    wake = undefined;
    pendingWake?.();
  };

  const pump = () => {
    while (
      !stopped &&
      generation === activeGeneration &&
      activeLoads < concurrency &&
      nextToStart < uris.length &&
      nextToStart < nextToYield + concurrency
    ) {
      const index = nextToStart;
      nextToStart += 1;
      activeLoads += 1;
      const uri = uris[index];
      const uriKey = workspaceUriKey(uri);
      void loadDiskEntry(uri, schema, maxLines, previousDocuments.get(uriKey), byteLimits)
        .then((result) => {
          results.set(index, result);
        })
        /* v8 ignore start -- loadDiskEntry returns read failures as results; this guards unexpected rejections. */
        .catch((error: unknown) => {
          errors.set(index, error);
        })
        /* v8 ignore stop */
        .finally(() => {
          activeLoads -= 1;
          pump();
          notify();
        });
    }
  };

  try {
    pump();
    while (nextToYield < uris.length) {
      while (!results.has(nextToYield) && !errors.has(nextToYield)) {
        /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
        if (generation !== activeGeneration) {
          return;
        }
        /* v8 ignore stop */
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
      if (generation !== activeGeneration) {
        return;
      }
      /* v8 ignore stop */
      if (errors.has(nextToYield)) {
        /* v8 ignore next -- loadDiskEntry returns read failures as results; this guards unexpected rejections. */
        throw errors.get(nextToYield);
      }
      const result = results.get(nextToYield)!;
      results.delete(nextToYield);
      yield { result };
      nextToYield += 1;
      pump();
    }
  } finally {
    stopped = true;
  }
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
  scope: WorkspaceRebuildScope,
): Promise<WorkspaceSymbolIndex | null> {
  const label = folderLabel(folder, folderKey);
  logWorkspaceIndexStarted(folderKey, label, scope, settings);
  const startedAt = Date.now();
  const byteLimits = {
    maxFileBytes: settings.maxFileBytes,
    maxLineBytes: settings.maxLineBytes,
  };
  let discoverySettings = settings;
  let discovery = await getDiscoveryResult(discoverySettings, folder, folderKey, forceRediscover);
  let expandedDiscovery = false;

  for (;;) {
    const uris = discovery.uris;
    /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
    if (generation !== activeGeneration) {
      return null;
    }
    /* v8 ignore stop */

    const documents = new Map<string, WorkspaceDocumentSymbols>();
    const skipReasons: Partial<Record<WorkspaceEntrySkipReason, number>> = {};
    let totalLines = 0;
    let totalBytes = 0;
    let capReason: string | undefined;

    for await (const { result } of loadDiskEntriesInDiscoveryOrder(
      uris,
      schema,
      maxLines,
      previousDocuments,
      byteLimits,
      generation,
    )) {
      const { entry, skipReason } = result;
      /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
      if (generation !== activeGeneration) {
        return null;
      }
      /* v8 ignore stop */
      if (!entry) {
        logReadFailureIfPresent(result);
        recordSkipReason(skipReasons, skipReason);
        continue;
      }
      if (fileLimitReached(documents.size, settings.maxFiles)) {
        capReason = "maxFiles";
        const capped = aggregateDocuments(generation, true, new Map());
        logWorkspaceIndexCompleted({
          folderKey,
          folderLabel: label,
          scope,
          discoveredFiles: uris.length,
          indexedFiles: documents.size,
          skippedFiles: uris.length - documents.size,
          skipReasons,
          capped: true,
          capReason,
          totalLines,
          totalBytes,
          durationMs: Date.now() - startedAt,
        });
        return capped;
      }
      totalLines += entry.parsed.length;
      if (limitExceeded(totalLines, settings.maxTotalLines)) {
        capReason = "maxTotalLines";
        const capped = aggregateDocuments(generation, true, new Map());
        logWorkspaceIndexCompleted({
          folderKey,
          folderLabel: label,
          scope,
          discoveredFiles: uris.length,
          indexedFiles: documents.size,
          skippedFiles: uris.length - documents.size,
          skipReasons,
          capped: true,
          capReason,
          totalLines,
          totalBytes,
          durationMs: Date.now() - startedAt,
        });
        return capped;
      }
      totalBytes += entry.byteLength;
      if (limitExceeded(totalBytes, settings.maxTotalBytes)) {
        capReason = "maxTotalBytes";
        const capped = aggregateDocuments(generation, true, new Map());
        logWorkspaceIndexCompleted({
          folderKey,
          folderLabel: label,
          scope,
          discoveredFiles: uris.length,
          indexedFiles: documents.size,
          skippedFiles: uris.length - documents.size,
          skipReasons,
          capped: true,
          capReason,
          totalLines,
          totalBytes,
          durationMs: Date.now() - startedAt,
        });
        return capped;
      }
      documents.set(entry.uriKey, entry);
    }

    if (discovery.capped && hasSkipReasons(skipReasons) && !expandedDiscovery) {
      expandedDiscovery = true;
      discoverySettings = {
        ...settings,
        maxFiles: settings.maxFiles + FOREIGN_CFG_DISCOVERY_EXTRA,
      };
      discovery = await getDiscoveryResult(discoverySettings, folder, folderKey, true);
      continue;
    }

    if (discovery.capped) {
      capReason = "maxFiles";
      const capped = aggregateDocuments(generation, true, new Map());
      logWorkspaceIndexCompleted({
        folderKey,
        folderLabel: label,
        scope,
        discoveredFiles: uris.length,
        indexedFiles: documents.size,
        skippedFiles: uris.length - documents.size,
        skipReasons,
        capped: true,
        capReason,
        totalLines,
        totalBytes,
        durationMs: Date.now() - startedAt,
      });
      return capped;
    }

    const index = aggregateDocuments(generation, false, documents);
    logWorkspaceIndexCompleted({
      folderKey,
      folderLabel: label,
      scope,
      discoveredFiles: uris.length,
      indexedFiles: documents.size,
      skippedFiles: uris.length - documents.size,
      skipReasons,
      capped: false,
      totalLines,
      totalBytes,
      durationMs: Date.now() - startedAt,
    });
    return index;
  }
}

async function updateSingleDocumentInWorkspaceIndex(
  document: vscode.TextDocument,
  resolveSchema: (folder: vscode.WorkspaceFolder | undefined) => Promise<HaproxySchema>,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
): Promise<void> {
  const folder = workspaceFolderForUri(document.uri);
  const folderKey = workspaceFolderKey(folder);
  const existing = activeWorkspaceIndexes.get(folderKey);
  if (!existing || existing.capped) {
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: "content",
    });
    return;
  }

  const uriKey = workspaceUriKey(document.uri);
  if (!existing.documents.has(uriKey)) {
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: "full",
    });
    return;
  }

  const schema = await resolveSchema(folder);
  /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
  if (generation !== activeGeneration) {
    return;
  }
  /* v8 ignore stop */

  const byteLimits = {
    maxFileBytes: settings.maxFileBytes,
    maxLineBytes: settings.maxLineBytes,
  };
  const { entry } = createOpenDocumentEntry(
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
  resolveSchema: (folder: vscode.WorkspaceFolder | undefined) => Promise<HaproxySchema>,
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
      logWorkspaceIndexDisabled();
      notifyWorkspaceIndexChanged({ scope: options.scope ?? "full", document: options.document });
    }
    return;
  }

  const scope = options.scope ?? "full";
  if (scope === "incremental" && options.document) {
    await updateSingleDocumentInWorkspaceIndex(
      options.document,
      resolveSchema,
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
    let schema: HaproxySchema;
    try {
      schema = await resolveSchema(folder);
    } catch (error) {
      logWorkspaceIndexSchemaLoadFailed(folderLabel(folder, folderKey), scope, error);
      continue;
    }
    /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
    if (generation !== activeGeneration) {
      return;
    }
    /* v8 ignore stop */
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
      scope,
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
  schemaSource: WorkspaceSchemaSource,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  options: WorkspaceRebuildOptions = { scope: "full" },
): void {
  const scope = options.scope ?? "full";
  if (scope === "none") {
    return;
  }

  activeSchemaSource = schemaSource;
  activeSettings = settings;
  activeMaxLines = maxLines;
  const resolveSchema = normalizeSchemaSource(schemaSource);
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
    void flushPendingRebuild(resolveSchema, settings, maxLines, generation, rebuildWork);
  }, settings.debounceMs);
}

export function refreshWorkspaceSymbolIndexNow(): void {
  if (!activeSchemaSource || !activeSettings) {
    return;
  }
  scheduleWorkspaceSymbolIndexRebuild(activeSchemaSource, activeSettings, activeMaxLines, {
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
  activeSchemaSource = null;
  activeMaxLines = 0;
  pendingRebuild = createEmptyPendingRebuild();
  invalidateDiscoveryCache();
}

export function setWorkspaceSymbolIndexChangeListener(
  listener: ((event: WorkspaceIndexChangeEvent) => void) | undefined,
): void {
  onDidChangeWorkspaceIndex = listener;
}
