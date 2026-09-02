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

let pendingRebuild = createEmptyPendingRebuild();
let inFlightRebuild: PendingRebuild | null = null;

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

function mergePendingRebuilds(current: PendingRebuild, incoming: PendingRebuild): PendingRebuild {
  if (current.workspaceFull || incoming.workspaceFull) {
    return { ...createEmptyPendingRebuild(), workspaceFull: true };
  }
  if (current.workspaceContent || incoming.workspaceContent) {
    return { ...createEmptyPendingRebuild(), workspaceContent: true };
  }

  const next: PendingRebuild = {
    workspaceFull: false,
    workspaceContent: false,
    folderTargets: new Map(current.folderTargets),
    incrementalDocuments: new Map(current.incrementalDocuments),
  };

  for (const [folderKey, target] of incoming.folderTargets) {
    if (target.forceRediscover) {
      removeIncrementalDocumentsInFolder(next.incrementalDocuments, folderKey);
    }
    const existing = next.folderTargets.get(folderKey);
    next.folderTargets.set(folderKey, {
      forceRediscover: target.forceRediscover || (existing?.forceRediscover ?? false),
      uri: target.uri,
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

  const incrementalDocuments = [...pending.incrementalDocuments.values()];
  const hasFollowOnRebuild = pending.workspaceContent || pending.folderTargets.size > 0;
  let incrementalGraphChanged = false;
  for (const document of incrementalDocuments) {
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
    if (graphChanged) {
      incrementalGraphChanged = true;
    }
  }
  if (incrementalDocuments.length > 0 && !hasFollowOnRebuild && incrementalGraphChanged) {
    notifyIncrementalBatch(incrementalDocuments);
  }

  if (pending.workspaceContent) {
    assertCurrentWorkspaceGeneration(generation);
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: "content",
    });
    return;
  }

  for (const target of pending.folderTargets.values()) {
    assertCurrentWorkspaceGeneration(generation);
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: target.forceRediscover ? "full" : "content",
      uri: target.uri,
    });
  }
}

function notifyIncrementalBatch(documents: readonly vscode.TextDocument[]): void {
  if (documents.length === 1) {
    notifyWorkspaceIndexChanged({ scope: "incremental", document: documents[0] });
    return;
  }
  notifyWorkspaceIndexChanged({ scope: "content", document: documents[0] });
}

export function resolveWorkspaceRebuildScopeOnOpen(
  document: vscode.TextDocument,
): WorkspaceRebuildScope {
  if (!isHaproxyLanguageId(document.languageId)) {
    return "none";
  }

  const folderKey = workspaceFolderKey(workspaceFolderForUri(document.uri));
  const folderIndex = getActiveWorkspaceIndexes().get(folderKey);
  if (!folderIndex || folderIndex.capped) {
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
  return rebuildTimer !== undefined;
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
  if (!existing || existing.capped) {
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: "content",
    });
    return true;
  }

  const uriKey = workspaceUriKey(document.uri);
  if (!existing.documents.has(uriKey)) {
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: "full",
    });
    return true;
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

  if (previous && sameSymbolGraph(previous.index, entry.index)) {
    if (previous.fingerprint !== entry.fingerprint || previous.version !== entry.version) {
      const documents = new Map(existing.documents);
      documents.set(entry.uriKey, entry);
      setFolderWorkspaceIndex(folderKey, { ...existing, documents });
    }
    return false;
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
  return true;
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
    invalidateDiscoveryCache();
  }

  const activeWorkspaceIndexes = getActiveWorkspaceIndexes();
  const folderRefs = targetFolderRefs(options, activeWorkspaceIndexes.keys());
  const foldersToRebuild = new Set(folderRefs.map((ref) => ref.folderKey));
  const nextIndexes = new Map<string, WorkspaceSymbolIndex>();
  const workspaceWide = !options.document && !options.uri;

  for (const [folderKey, index] of activeWorkspaceIndexes) {
    if (!foldersToRebuild.has(folderKey) && !workspaceWide) {
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
    setFolderWorkspaceIndex(folderKey, index, nextIndexes, activeWorkspaceIndexes);
  }

  assertCurrentWorkspaceGeneration(generation);
  setActiveWorkspaceIndexes(nextIndexes);
  rebuildCappedFolderKeys(nextIndexes);
  notifyWorkspaceIndexChanged({ scope, document: options.document });
  return true;
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
  const mergeBase = inFlightRebuild
    ? mergePendingRebuilds(inFlightRebuild, pendingRebuild)
    : pendingRebuild;
  pendingRebuild = mergePendingRebuild(mergeBase, {
    scope,
    document: options.document,
    uri: options.uri,
  });
  const generation = bumpActiveGeneration();
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    const rebuildWork = pendingRebuild;
    pendingRebuild = createEmptyPendingRebuild();
    inFlightRebuild = rebuildWork;
    void flushPendingRebuild(resolveSchema, settings, maxLines, generation, rebuildWork)
      .catch(rethrowUnlessStaleWorkspaceGeneration)
      .finally(() => {
        if (inFlightRebuild === rebuildWork) {
          inFlightRebuild = null;
        }
      });
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
  invalidateDiscoveryCache();
}

export function setWorkspaceSymbolIndexChangeListener(
  listener: ((event: WorkspaceIndexChangeEvent) => void) | undefined,
): void {
  setWorkspaceIndexChangeListener(listener);
}
