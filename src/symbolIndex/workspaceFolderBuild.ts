import * as vscode from "vscode";

import {
  logDiskEntryReadFailure,
  logWorkspaceIndexCompleted,
  logWorkspaceIndexStarted,
  WorkspaceEntrySkipReason,
} from "../outputChannel";
import { HaproxySchema } from "../schema";

import { aggregateDocuments, loadDiskEntry, WorkspaceEntryLoadResult } from "./workspaceDocuments";
import { getDiscoveryResult } from "./workspaceDiscovery";
import { fileLimitReached, folderLabel, isStaleGeneration, limitExceeded } from "./workspaceState";
import {
  WorkspaceDocumentSymbols,
  WorkspaceRebuildScope,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSettings,
} from "./workspaceTypes";
import { workspaceUriKey } from "./workspaceUri";

const FOREIGN_CFG_DISCOVERY_EXTRA = 100;
const DISK_ENTRY_LOAD_CONCURRENCY = 8;

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
      !isStaleGeneration(generation) &&
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
        if (isStaleGeneration(generation)) {
          return;
        }
        /* v8 ignore stop */
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      /* v8 ignore start -- stale async generations are race guards for VS Code file scans. */
      if (isStaleGeneration(generation)) {
        return;
      }
      /* v8 ignore stop */
      /* v8 ignore next 3 -- loadDiskEntry returns read failures as results; this guards unexpected rejections. */
      if (errors.has(nextToYield)) {
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

export async function buildFolderWorkspaceIndex(
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
    if (isStaleGeneration(generation)) {
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
      if (isStaleGeneration(generation)) {
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
        return aggregateDocuments(generation, true, new Map());
      }
      totalLines += entry.parsed.length;
      if (limitExceeded(totalLines, settings.maxTotalLines)) {
        capReason = "maxTotalLines";
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
        return aggregateDocuments(generation, true, new Map());
      }
      totalBytes += entry.byteLength;
      if (limitExceeded(totalBytes, settings.maxTotalBytes)) {
        capReason = "maxTotalBytes";
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
        return aggregateDocuments(generation, true, new Map());
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
      return aggregateDocuments(generation, true, new Map());
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
