import * as vscode from "vscode";

import { documentContentFingerprint } from "../documentUriKey";
import { HaproxySchema } from "../schema";

import {
  aggregateDocuments,
  createDiskEntry,
  createOpenDocumentEntry,
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

type ActiveWorkspaceRebuildScope = Exclude<WorkspaceRebuildScope, "none">;
type ActiveWorkspaceRebuildOptions = Omit<WorkspaceRebuildOptions, "scope"> & {
  scope?: ActiveWorkspaceRebuildScope;
};

let pendingRebuildOptions: ActiveWorkspaceRebuildOptions = { scope: "full" };

export function workspaceEntryForDocument(
  document: vscode.TextDocument,
): WorkspaceDocumentSymbols | undefined {
  const folderKey = workspaceFolderKey(workspaceFolderForUri(document.uri));
  return activeWorkspaceIndexes.get(folderKey)?.documents.get(workspaceUriKey(document.uri));
}

export function resolveWorkspaceRebuildScopeOnOpen(
  document: vscode.TextDocument,
): WorkspaceRebuildScope {
  if (document.languageId !== "haproxy") {
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
  if (!uris) {
    return aggregateDocuments(generation, true, new Map());
  }

  const documents = new Map<string, WorkspaceDocumentSymbols>();
  let totalLines = 0;
  for (const uri of uris) {
    const uriKey = workspaceUriKey(uri);
    const entry = await createDiskEntry(uri, schema, maxLines, previousDocuments.get(uriKey));
    /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
    if (generation !== activeGeneration) {
      return null;
    }
    /* v8 ignore stop */
    if (!entry) {
      continue;
    }
    totalLines += entry.parsed.length;
    if (totalLines > settings.maxTotalLines) {
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

  const entry = createOpenDocumentEntry(document, schema, maxLines, existing.documents.get(uriKey));
  /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
  if (generation !== activeGeneration) {
    return;
  }
  /* v8 ignore stop */
  if (!entry) {
    const documents = new Map(existing.documents);
    documents.delete(uriKey);
    activeWorkspaceIndexes.set(folderKey, aggregateDocuments(generation, false, documents));
    notifyWorkspaceIndexChanged({ scope: "incremental", document });
    return;
  }

  const documents = new Map(existing.documents);
  documents.set(entry.uriKey, entry);
  if (totalDocumentLines(documents) > settings.maxTotalLines) {
    activeWorkspaceIndexes.set(folderKey, aggregateDocuments(generation, true, new Map()));
  } else {
    activeWorkspaceIndexes.set(folderKey, aggregateDocuments(generation, false, documents));
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
    nextIndexes.set(folderKey, index);
  }

  /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
  if (generation !== activeGeneration) {
    return;
  }
  /* v8 ignore stop */
  activeWorkspaceIndexes = nextIndexes;
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
  pendingRebuildOptions = {
    scope,
    document: options.document,
    uri: options.uri,
  };
  activeGeneration += 1;
  const generation = activeGeneration;
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    const rebuildOptions = pendingRebuildOptions;
    pendingRebuildOptions = { scope: "full" };
    void rebuildWorkspaceIndexes(schema, settings, maxLines, generation, rebuildOptions);
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
  activeSettings = null;
  activeSchema = null;
  activeMaxLines = 0;
  pendingRebuildOptions = { scope: "full" };
  invalidateDiscoveryCache();
}

export function setWorkspaceSymbolIndexChangeListener(
  listener: ((event: WorkspaceIndexChangeEvent) => void) | undefined,
): void {
  onDidChangeWorkspaceIndex = listener;
}
