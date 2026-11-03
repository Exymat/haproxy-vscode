/** Schedules and runs workspace symbol-index rebuilds on document and workspace changes. */
import * as vscode from "vscode";

import { isHaproxyLanguageId } from "../extension/grammar";
import {
  logWorkspaceIndexDisabled,
  logWorkspaceIndexSchemaLoadFailed,
} from "../extension/outputChannel";
import { HaproxySchema } from "../schema/types";

import { buildFolderWorkspaceIndex } from "./workspaceFolderBuild";
import { sameSymbolGraph } from "./utils";
import {
  aggregateDocuments,
  createOpenDocumentEntry,
  sameLineTexts,
  totalDocumentBytes,
  totalDocumentLines,
} from "./workspaceDocuments";
import {
  invalidateDiscoveryCache,
  isWorkspaceSymbolUri,
  isUriIncludedInWorkspaceSymbols,
  isUriExcludedFromWorkspaceSymbols,
  targetFolderRefs,
  workspaceFolderForUri,
  workspaceFolderKey,
} from "./workspaceDiscovery";
import {
  assertCurrentWorkspaceGeneration,
  bumpActiveGeneration,
  folderLabel,
  getActiveGeneration,
  getActiveWorkspaceIndexes,
  limitExceeded,
  notifyWorkspaceIndexChanged,
  rebuildCappedFolderKeys,
  rethrowUnlessStaleWorkspaceGeneration,
  resetWorkspaceIndexState,
  setActiveWorkspaceIndexes,
  setFolderWorkspaceIndex,
  setWorkspaceIndexChangeListener,
} from "./workspaceState";
import {
  WorkspaceDocumentSymbols,
  WorkspaceIndexChangeEvent,
  WorkspaceRebuildOptions,
  WorkspaceRebuildScope,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSettings,
} from "./workspaceTypes";
import { workspaceUriKey } from "./workspaceUri";

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

let rebuildTimer: NodeJS.Timeout | undefined;
let activeSettings: WorkspaceSymbolSettings | null = null;
let activeSchemaSource: WorkspaceSchemaSource | null = null;
let activeMaxLines = 0;

type ActiveWorkspaceRebuildScope = Exclude<WorkspaceRebuildScope, "none">;
type ResolvedWorkspaceRebuildOptions = Omit<WorkspaceRebuildOptions, "scope"> & {
  scope: ActiveWorkspaceRebuildScope;
};

interface PendingFolderTarget {
  forceRediscover: boolean;
  uri?: vscode.Uri;
}

interface PendingRebuild {
  folderTargets: Map<string, PendingFolderTarget>;
  incrementalDocuments: Map<string, vscode.TextDocument>;
}

function createEmptyPendingRebuild(): PendingRebuild {
  return { folderTargets: new Map(), incrementalDocuments: new Map() };
}

let pendingRebuild = createEmptyPendingRebuild();
let inFlightRebuild: PendingRebuild | null = null;
let inFlightPromise: Promise<void> | null = null;
let rebuildRequest = 0;

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
  options: ResolvedWorkspaceRebuildOptions,
): PendingRebuild {
  const { scope } = options;

  const next: PendingRebuild = {
    folderTargets: new Map(current.folderTargets),
    incrementalDocuments: new Map(current.incrementalDocuments),
  };

  if (scope === "incremental" && options.document) {
    next.incrementalDocuments.set(workspaceUriKey(options.document.uri), options.document);
    return next;
  }

  if (scope === "incremental") {
    return next;
  }
  // Expand workspace requests here so each root retains its strongest pending scope.
  for (const { folder, folderKey } of targetFolderRefs(options, [])) {
    const forceRediscover = scope === "full";
    if (forceRediscover) {
      removeIncrementalDocumentsInFolder(next.incrementalDocuments, folderKey);
    }
    const existing = next.folderTargets.get(folderKey);
    next.folderTargets.set(folderKey, {
      forceRediscover: forceRediscover || (existing?.forceRediscover ?? false),
      uri: folder?.uri,
    });
  }
  return next;
}

function mergePendingRebuilds(current: PendingRebuild, incoming: PendingRebuild): PendingRebuild {
  const next: PendingRebuild = {
    folderTargets: new Map(current.folderTargets),
    incrementalDocuments: new Map(current.incrementalDocuments),
  };
  for (const [folderKey, target] of incoming.folderTargets) {
    if (target.forceRediscover) {
      removeIncrementalDocumentsInFolder(next.incrementalDocuments, folderKey);
    }
    const previous = next.folderTargets.get(folderKey);
    next.folderTargets.set(folderKey, {
      uri: target.uri,
      forceRediscover: target.forceRediscover || (previous?.forceRediscover ?? false),
    });
  }
  for (const [uriKey, document] of incoming.incrementalDocuments) {
    const folderKey = workspaceFolderKey(workspaceFolderForUri(document.uri));
    if (!next.folderTargets.get(folderKey)?.forceRediscover) {
      next.incrementalDocuments.set(uriKey, document);
    }
  }
  return next;
}

function pendingFolderKeys(pending: PendingRebuild): Set<string> {
  return new Set([
    ...pending.folderTargets.keys(),
    ...[...pending.incrementalDocuments.values()].map((document) =>
      workspaceFolderKey(workspaceFolderForUri(document.uri)),
    ),
  ]);
}

async function flushPendingRebuild(
  resolveSchema: (folder: vscode.WorkspaceFolder | undefined) => Promise<HaproxySchema>,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
  pending: PendingRebuild,
): Promise<void> {
  const changedDocuments = new Map<string, vscode.TextDocument[]>();
  try {
    for (const [uriKey, document] of pending.incrementalDocuments) {
      assertCurrentWorkspaceGeneration(generation);
      const graphChanged = await rebuildWorkspaceIndexes(
        resolveSchema,
        settings,
        maxLines,
        generation,
        {
          scope: "incremental",
          document,
        },
      );
      assertCurrentWorkspaceGeneration(generation);
      pending.incrementalDocuments.delete(uriKey);
      if (graphChanged) {
        const folderKey = workspaceFolderKey(workspaceFolderForUri(document.uri));
        const documents = changedDocuments.get(folderKey) ?? [];
        documents.push(document);
        changedDocuments.set(folderKey, documents);
      }
    }
  } finally {
    for (const documents of changedDocuments.values()) {
      notifyWorkspaceIndexChanged({
        scope: documents.length === 1 ? "incremental" : "content",
        document: documents[0],
      });
    }
  }

  for (const [folderKey, target] of pending.folderTargets) {
    if (target.uri && !isWorkspaceSymbolUri(target.uri)) {
      pending.folderTargets.delete(folderKey);
      continue;
    }
    assertCurrentWorkspaceGeneration(generation);
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: target.forceRediscover ? "full" : "content",
      uri: target.uri,
    });
    assertCurrentWorkspaceGeneration(generation);
    // Retire published work before another request can supersede this batch.
    pending.folderTargets.delete(folderKey);
  }
}

export function resolveWorkspaceRebuildScopeOnOpen(
  document: vscode.TextDocument,
): WorkspaceRebuildScope {
  if (!isHaproxyLanguageId(document.languageId) || !isWorkspaceSymbolUri(document.uri)) {
    return "none";
  }

  const folderKey = workspaceFolderKey(workspaceFolderForUri(document.uri));
  const folderIndex = getActiveWorkspaceIndexes().get(folderKey);
  if (folderIndex?.capped) {
    return "none";
  }
  if (!folderIndex) {
    return "full";
  }

  const uriKey = workspaceUriKey(document.uri);
  const entry = folderIndex.documents.get(uriKey);
  if (!entry) {
    return "full";
  }

  if (entry.version !== null && entry.version === document.version) {
    return "none";
  }
  if (sameLineTexts(entry.lineTexts, document.getText().split(/\r?\n/))) {
    return "none";
  }

  return "incremental";
}

export function isWorkspaceRebuildPending(): boolean {
  return rebuildTimer !== undefined || pendingFolderKeys(pendingRebuild).size > 0;
}

async function updateSingleDocumentInWorkspaceIndex(
  document: vscode.TextDocument,
  resolveSchema: (folder: vscode.WorkspaceFolder | undefined) => Promise<HaproxySchema>,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
): Promise<boolean> {
  const folder = workspaceFolderForUri(document.uri);
  const folderKey = workspaceFolderKey(folder);
  const activeWorkspaceIndexes = getActiveWorkspaceIndexes();
  const existing = activeWorkspaceIndexes.get(folderKey);
  if (existing?.capped) {
    return false;
  }
  if (!existing) {
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: "content",
      uri: document.uri,
    });
    return false;
  }

  const uriKey = workspaceUriKey(document.uri);
  if (!existing.documents.has(uriKey)) {
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: "full",
      uri: document.uri,
    });
    return false;
  }

  const schema = await resolveSchema(folder);
  assertCurrentWorkspaceGeneration(generation);

  const byteLimits = {
    maxFileBytes: settings.maxFileBytes,
    maxLineBytes: settings.maxLineBytes,
  };
  const previous = existing.documents.get(uriKey);
  const { entry } = createOpenDocumentEntry(document, schema, maxLines, previous, byteLimits);
  assertCurrentWorkspaceGeneration(generation);
  if (!entry) {
    const documents = new Map(existing.documents);
    documents.delete(uriKey);
    setFolderWorkspaceIndex(folderKey, aggregateDocuments(generation, false, documents));
    return true;
  }

  const documents = new Map(existing.documents);
  documents.set(entry.uriKey, entry);
  if (
    limitExceeded(totalDocumentLines(documents), settings.maxTotalLines) ||
    limitExceeded(totalDocumentBytes(documents), settings.maxTotalBytes)
  ) {
    setFolderWorkspaceIndex(folderKey, aggregateDocuments(generation, true, new Map()));
    return true;
  }
  if (previous && sameSymbolGraph(previous.index, entry.index)) {
    if (previous.fingerprint !== entry.fingerprint || previous.version !== entry.version) {
      setFolderWorkspaceIndex(folderKey, { ...existing, documents });
    }
    return false;
  }
  setFolderWorkspaceIndex(folderKey, aggregateDocuments(generation, false, documents));
  return true;
}

function sameWorkspaceGraph(
  previous: WorkspaceSymbolIndex | undefined,
  next: WorkspaceSymbolIndex,
): boolean {
  if (
    !previous ||
    previous.capped !== next.capped ||
    previous.documents.size !== next.documents.size
  ) {
    return false;
  }
  for (const [key, entry] of next.documents) {
    const oldEntry = previous.documents.get(key);
    if (!oldEntry || !sameSymbolGraph(oldEntry.index, entry.index)) {
      return false;
    }
  }
  return true;
}

function retainConfiguredFolderIndexes(indexes: Map<string, WorkspaceSymbolIndex>): void {
  // Another root may have been removed while a build awaited disk I/O.
  const currentKeys = new Set(targetFolderRefs({}, []).map((ref) => ref.folderKey));
  for (const key of indexes.keys()) {
    if (!currentKeys.has(key)) {
      indexes.delete(key);
    }
  }
}

async function rebuildWorkspaceIndexes(
  resolveSchema: (folder: vscode.WorkspaceFolder | undefined) => Promise<HaproxySchema>,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  generation: number,
  options: ResolvedWorkspaceRebuildOptions,
): Promise<boolean> {
  if (!settings.enabled) {
    if (generation === getActiveGeneration()) {
      resetWorkspaceIndexState();
      invalidateDiscoveryCache();
      logWorkspaceIndexDisabled();
      notifyWorkspaceIndexChanged({ scope: options.scope, document: options.document });
    }
    return true;
  }

  const { scope } = options;
  if (scope === "incremental" && options.document) {
    return updateSingleDocumentInWorkspaceIndex(
      options.document,
      resolveSchema,
      settings,
      maxLines,
      generation,
    );
  }

  const forceRediscover = scope === "full";
  if (forceRediscover) {
    const uri = options.document?.uri ?? options.uri;
    invalidateDiscoveryCache(uri ? workspaceFolderKey(workspaceFolderForUri(uri)) : undefined);
  }

  const activeWorkspaceIndexes = getActiveWorkspaceIndexes();
  const folderRefs = targetFolderRefs(options, activeWorkspaceIndexes.keys());
  const foldersToRebuild = new Set(folderRefs.map((ref) => ref.folderKey));
  const nextIndexes = new Map<string, WorkspaceSymbolIndex>();
  const workspaceWide = !options.document && !options.uri;

  for (const [folderKey, index] of activeWorkspaceIndexes) {
    if (!foldersToRebuild.has(folderKey) && !workspaceWide) {
      nextIndexes.set(folderKey, index);
    }
  }

  let graphChanged = false;
  for (const { folder, folderKey } of folderRefs) {
    let schema: HaproxySchema;
    try {
      schema = await resolveSchema(folder);
    } catch (error) {
      logWorkspaceIndexSchemaLoadFailed(folderLabel(folder, folderKey), scope, error);
      graphChanged = true;
      continue;
    }
    assertCurrentWorkspaceGeneration(generation);
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
    assertCurrentWorkspaceGeneration(generation);
    const previous = activeWorkspaceIndexes.get(folderKey);
    if (sameWorkspaceGraph(previous, index) && previous) {
      index.revision = previous.revision;
      index.generation = previous.generation;
    } else {
      graphChanged = true;
    }
    setFolderWorkspaceIndex(folderKey, index, nextIndexes, activeWorkspaceIndexes);
  }

  assertCurrentWorkspaceGeneration(generation);
  retainConfiguredFolderIndexes(nextIndexes);
  setActiveWorkspaceIndexes(nextIndexes);
  rebuildCappedFolderKeys(nextIndexes);
  if (graphChanged) {
    notifyWorkspaceIndexChanged({ scope, document: options.document, uri: options.uri });
  }
  return graphChanged;
}

export function scheduleWorkspaceSymbolIndexRebuild(
  schemaSource: WorkspaceSchemaSource,
  settings: WorkspaceSymbolSettings,
  maxLines: number,
  options: WorkspaceRebuildOptions = { scope: "full" },
): void {
  const scope = options.scope ?? "full";
  const uri = options.document?.uri ?? options.uri;
  if (scope === "none" || (uri && !isWorkspaceSymbolUri(uri))) {
    return;
  }

  if (options.document) {
    const folder = workspaceFolderForUri(options.document.uri);
    if (
      !isUriIncludedInWorkspaceSymbols(options.document.uri, settings, folder) ||
      isUriExcludedFromWorkspaceSymbols(options.document.uri, settings, folder)
    ) {
      return;
    }
  }

  const incoming = mergePendingRebuild(createEmptyPendingRebuild(), {
    scope,
    document: options.document,
    uri: options.uri,
  });
  const runningKeys = inFlightRebuild ? pendingFolderKeys(inFlightRebuild) : new Set<string>();
  const settingsChanged =
    activeSchemaSource !== schemaSource ||
    activeMaxLines !== maxLines ||
    JSON.stringify(activeSettings) !== JSON.stringify(settings);
  const overlaps = [...pendingFolderKeys(incoming)].some((key) => runningKeys.has(key));
  // Unrelated roots can finish without being cancelled by the next request.
  if (inFlightRebuild && (settingsChanged || overlaps)) {
    pendingRebuild = mergePendingRebuilds(inFlightRebuild, pendingRebuild);
    inFlightRebuild = null;
    inFlightPromise = null;
    bumpActiveGeneration();
  }
  pendingRebuild = mergePendingRebuilds(pendingRebuild, incoming);
  activeSchemaSource = schemaSource;
  activeSettings = settings;
  activeMaxLines = maxLines;
  const request = ++rebuildRequest;
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }
  const run = (): void => {
    if (request !== rebuildRequest || pendingFolderKeys(pendingRebuild).size === 0) {
      return;
    }
    const generation = bumpActiveGeneration();
    const rebuildWork = pendingRebuild;
    pendingRebuild = createEmptyPendingRebuild();
    inFlightRebuild = rebuildWork;
    const promise = flushPendingRebuild(
      normalizeSchemaSource(schemaSource),
      settings,
      maxLines,
      generation,
      rebuildWork,
    )
      .catch(rethrowUnlessStaleWorkspaceGeneration)
      .finally(() => {
        if (inFlightRebuild === rebuildWork) {
          inFlightRebuild = null;
          inFlightPromise = null;
        }
      });
    inFlightPromise = promise;
  };
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    if (inFlightPromise) {
      void inFlightPromise.then(run);
    } else {
      run();
    }
  }, settings.debounceMs);
}

export function removeWorkspaceSymbolFolders(uris: readonly vscode.Uri[]): void {
  if (uris.length === 0) {
    return;
  }
  const removedKeys = new Set(uris.map(workspaceUriKey));
  const documentWasRemoved = (document: vscode.TextDocument): boolean => {
    const documentKey = workspaceUriKey(document.uri);
    const owner = workspaceFolderForUri(document.uri);
    const ownerKey = owner ? workspaceUriKey(owner.uri) : undefined;
    return [...removedKeys].some(
      (key) => documentKey.startsWith(`${key}/`) && !ownerKey?.startsWith(`${key}/`),
    );
  };
  const cancelsRunning =
    inFlightRebuild !== null &&
    ([...inFlightRebuild.folderTargets.keys()].some((key) => removedKeys.has(key)) ||
      [...inFlightRebuild.incrementalDocuments.values()].some(documentWasRemoved));
  if (cancelsRunning && inFlightRebuild) {
    pendingRebuild = mergePendingRebuilds(inFlightRebuild, pendingRebuild);
    inFlightRebuild = null;
    inFlightPromise = null;
    rebuildRequest += 1;
    bumpActiveGeneration();
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = undefined;
    }
  }
  const indexes = getActiveWorkspaceIndexes();
  for (const uri of uris) {
    const key = workspaceUriKey(uri);
    indexes.delete(key);
    invalidateDiscoveryCache(key);
    pendingRebuild.folderTargets.delete(key);
  }
  for (const [documentKey, document] of pendingRebuild.incrementalDocuments) {
    if (documentWasRemoved(document)) {
      pendingRebuild.incrementalDocuments.delete(documentKey);
    }
  }
  rebuildCappedFolderKeys(indexes);
  if (
    cancelsRunning &&
    activeSchemaSource &&
    activeSettings &&
    pendingFolderKeys(pendingRebuild).size > 0
  ) {
    scheduleWorkspaceSymbolIndexRebuild(activeSchemaSource, activeSettings, activeMaxLines, {
      scope: "incremental",
    });
  }
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
  bumpActiveGeneration();
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = undefined;
  }
  resetWorkspaceIndexState();
  activeSettings = null;
  activeSchemaSource = null;
  activeMaxLines = 0;
  pendingRebuild = createEmptyPendingRebuild();
  inFlightRebuild = null;
  inFlightPromise = null;
  rebuildRequest += 1;
  invalidateDiscoveryCache();
}

export function setWorkspaceSymbolIndexChangeListener(
  listener: ((event: WorkspaceIndexChangeEvent) => void) | undefined,
): void {
  setWorkspaceIndexChangeListener(listener);
}
