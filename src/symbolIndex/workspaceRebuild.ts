import * as vscode from "vscode";

import { documentContentFingerprint } from "../documentUriKey";
import { isHaproxyLanguageId } from "../grammar";
import { logWorkspaceIndexDisabled, logWorkspaceIndexSchemaLoadFailed } from "../outputChannel";
import { HaproxySchema } from "../schema";

import { buildFolderWorkspaceIndex } from "./workspaceFolderBuild";
import {
  aggregateDocuments,
  createOpenDocumentEntry,
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
  bumpActiveGeneration,
  folderLabel,
  getActiveGeneration,
  getActiveWorkspaceIndexes,
  isStaleGeneration,
  limitExceeded,
  notifyWorkspaceIndexChanged,
  rebuildCappedFolderKeys,
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

let pendingRebuild = createEmptyPendingRebuild();

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
    if (isStaleGeneration(generation)) {
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
    if (isStaleGeneration(generation)) {
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
    if (isStaleGeneration(generation)) {
      return;
    }
    /* v8 ignore stop */
    await rebuildWorkspaceIndexes(resolveSchema, settings, maxLines, generation, {
      scope: target.forceRediscover ? "full" : "content",
      uri: target.uri,
    });
  }
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

  if (entry.fingerprint === documentContentFingerprint(document)) {
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
): Promise<void> {
  const folder = workspaceFolderForUri(document.uri);
  const folderKey = workspaceFolderKey(folder);
  const activeWorkspaceIndexes = getActiveWorkspaceIndexes();
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
  if (isStaleGeneration(generation)) {
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
  if (isStaleGeneration(generation)) {
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
    if (generation === getActiveGeneration()) {
      resetWorkspaceIndexState();
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

  const activeWorkspaceIndexes = getActiveWorkspaceIndexes();
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
    if (isStaleGeneration(generation)) {
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
    if (isStaleGeneration(generation) || index === null) {
      return;
    }
    /* v8 ignore stop */
    setFolderWorkspaceIndex(folderKey, index, nextIndexes, activeWorkspaceIndexes);
  }

  /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
  if (isStaleGeneration(generation)) {
    return;
  }
  /* v8 ignore stop */
  setActiveWorkspaceIndexes(nextIndexes);
  rebuildCappedFolderKeys(nextIndexes);
  notifyWorkspaceIndexChanged({ scope, document: options.document });
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
  const generation = bumpActiveGeneration();
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
  invalidateDiscoveryCache();
}

export function setWorkspaceSymbolIndexChangeListener(
  listener: ((event: WorkspaceIndexChangeEvent) => void) | undefined,
): void {
  setWorkspaceIndexChangeListener(listener);
}
