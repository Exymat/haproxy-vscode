import * as vscode from "vscode";

import {
  GLOBAL_WORKSPACE_FOLDER_KEY,
  workspaceFolderForUri,
  workspaceFolderKey,
} from "./workspaceDiscovery";
import {
  WorkspaceDocumentSymbols,
  WorkspaceIndexChangeEvent,
  WorkspaceSymbolIndex,
} from "./workspaceTypes";
import { workspaceUriKey } from "./workspaceUri";

let activeWorkspaceIndexes = new Map<string, WorkspaceSymbolIndex>();
let activeGeneration = 0;
let onDidChangeWorkspaceIndex: ((event: WorkspaceIndexChangeEvent) => void) | undefined;
const notifiedCappedFolders = new Set<string>();
const cappedFolderKeys = new Set<string>();

export function getActiveGeneration(): number {
  return activeGeneration;
}

export function bumpActiveGeneration(): number {
  activeGeneration += 1;
  return activeGeneration;
}

export function isStaleGeneration(generation: number): boolean {
  return generation !== activeGeneration;
}

export function getActiveWorkspaceIndexes(): Map<string, WorkspaceSymbolIndex> {
  return activeWorkspaceIndexes;
}

export function setActiveWorkspaceIndexes(indexes: Map<string, WorkspaceSymbolIndex>): void {
  activeWorkspaceIndexes = indexes;
}

export function getWorkspaceIndexChangeListener():
  ((event: WorkspaceIndexChangeEvent) => void) | undefined {
  return onDidChangeWorkspaceIndex;
}

export function setWorkspaceIndexChangeListener(
  listener: ((event: WorkspaceIndexChangeEvent) => void) | undefined,
): void {
  onDidChangeWorkspaceIndex = listener;
}

export function clearNotifiedCappedFolders(): void {
  notifiedCappedFolders.clear();
}

export function clearCappedFolderKeys(): void {
  cappedFolderKeys.clear();
}

export function resetWorkspaceIndexState(): void {
  activeWorkspaceIndexes = new Map();
  clearCappedFolderKeys();
  clearNotifiedCappedFolders();
}

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

export function setFolderWorkspaceIndex(
  folderKey: string,
  newIndex: WorkspaceSymbolIndex,
  indexes: Map<string, WorkspaceSymbolIndex> = activeWorkspaceIndexes,
): void {
  const previousIndex = indexes.get(folderKey);
  updateCappedFolderTracking(folderKey, previousIndex, newIndex);
  indexes.set(folderKey, newIndex);
}

export function rebuildCappedFolderKeys(indexes: Map<string, WorkspaceSymbolIndex>): void {
  cappedFolderKeys.clear();
  for (const [folderKey, index] of indexes) {
    if (index.capped) {
      cappedFolderKeys.add(folderKey);
    }
  }
}

export function limitExceeded(value: number, limit: number): boolean {
  return limit > 0 && value > limit;
}

export function fileLimitReached(count: number, limit: number): boolean {
  return limit > 0 && count >= limit;
}

export function notifyWorkspaceIndexChanged(event: WorkspaceIndexChangeEvent): void {
  onDidChangeWorkspaceIndex?.(event);
}

export function folderLabel(folder: vscode.WorkspaceFolder | undefined, folderKey: string): string {
  return (
    folder?.name ??
    folder?.uri.fsPath ??
    (folderKey === GLOBAL_WORKSPACE_FOLDER_KEY ? "global" : folderKey)
  );
}

export function workspaceEntryForDocument(
  document: vscode.TextDocument,
): WorkspaceDocumentSymbols | undefined {
  const folderKey = workspaceFolderKey(workspaceFolderForUri(document.uri));
  return activeWorkspaceIndexes.get(folderKey)?.documents.get(workspaceUriKey(document.uri));
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
