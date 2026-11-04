/** Manages workspace symbol indexing, file watchers, and rebuild scheduling. */
import * as vscode from "vscode";

import { DiagnosticScheduler } from "../diagnostics/diagnosticScheduler";
import { ExtensionBundle } from "./extensionBundle";
import { isHaproxyLanguageId } from "./grammar";
import { HaproxyExtensionSettings } from "./settings";
import {
  clearWorkspaceSymbolIndex,
  effectiveWorkspaceSymbolIncludePatterns,
  removeWorkspaceSymbolFolders,
  isUriExcludedFromWorkspaceSymbols,
  isUriIncludedInWorkspaceSymbols,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
  workspaceUriKey,
  WorkspaceIndexChangeEvent,
  WorkspaceRebuildScope,
  WorkspaceSchemaSource,
  WorkspaceSymbolSettings,
} from "../symbolIndex";

interface WorkspaceWatcherRegistration extends vscode.Disposable {
  watcher: vscode.FileSystemWatcher;
  listeners: vscode.Disposable[];
}

export interface ExtensionWorkspaceSymbolService extends vscode.Disposable {
  configureWatchers: () => void;
  handleWorkspaceFoldersChanged: () => void;
  schedule: (
    scope?: WorkspaceRebuildScope,
    document?: vscode.TextDocument,
    uri?: vscode.Uri,
  ) => Promise<void>;
  scheduleForUri: (uri: vscode.Uri, scope: WorkspaceRebuildScope) => Promise<void>;
  scheduleRebuildWithReadyBundle: (scope?: WorkspaceRebuildScope) => void;
  settings: () => WorkspaceSymbolSettings;
}

interface ExtensionWorkspaceSymbolServiceOptions {
  getSettings: () => HaproxyExtensionSettings;
  getMaxSymbolLines: () => number;
  resolveWorkspaceSchema: WorkspaceSchemaSource;
  safeEnsureBundle: (uri?: vscode.Uri) => Promise<ExtensionBundle | undefined>;
  scheduler: DiagnosticScheduler;
  refreshWorkspaceIndexStatusBar: () => void;
}

export function createExtensionWorkspaceSymbolService(
  options: ExtensionWorkspaceSymbolServiceOptions,
): ExtensionWorkspaceSymbolService {
  const watcherRegistrations = new Map<string, WorkspaceWatcherRegistration>();
  let knownFolders = new Map(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => [
      workspaceUriKey(folder.uri),
      folder,
    ]),
  );

  const disposeWorkspaceWatchers = (): void => {
    for (const registration of watcherRegistrations.values()) {
      registration.dispose();
    }
    watcherRegistrations.clear();
  };

  const workspaceSymbolSettings = (): WorkspaceSymbolSettings => {
    const settings = options.getSettings();
    return {
      enabled: settings.workspaceSymbolsEnabled,
      include: settings.workspaceSymbolsInclude,
      exclude: settings.workspaceSymbolsExclude,
      roots: settings.workspaceSymbolsRoots,
      maxFiles: settings.workspaceSymbolsMaxFiles,
      maxTotalLines: settings.workspaceSymbolsMaxTotalLines,
      maxFileBytes: settings.workspaceSymbolsMaxFileBytes,
      maxTotalBytes: settings.workspaceSymbolsMaxTotalBytes,
      maxLineBytes: settings.workspaceSymbolsMaxLineBytes,
      debounceMs: settings.workspaceSymbolsDebounceMs,
    };
  };

  const openHaproxyDocuments = (): readonly vscode.TextDocument[] =>
    vscode.workspace.textDocuments.filter((document) => isHaproxyLanguageId(document.languageId));

  const openHaproxyDocumentsInFolder = (uri: vscode.Uri): readonly vscode.TextDocument[] => {
    const folder = vscode.workspace.getWorkspaceFolder?.(uri);
    if (!folder) {
      return openHaproxyDocuments().filter(
        (document) => !vscode.workspace.getWorkspaceFolder?.(document.uri),
      );
    }
    const folderKey = workspaceUriKey(folder.uri);
    return openHaproxyDocuments().filter((document) => {
      const documentFolder = vscode.workspace.getWorkspaceFolder?.(document.uri);
      return documentFolder !== undefined && workspaceUriKey(documentFolder.uri) === folderKey;
    });
  };

  const scheduleRebuildWithReadyBundle = (scope: WorkspaceRebuildScope = "full"): void => {
    scheduleWorkspaceSymbolIndexRebuild(
      options.resolveWorkspaceSchema,
      workspaceSymbolSettings(),
      options.getMaxSymbolLines(),
      { scope },
    );
  };

  const schedule = async (
    scope: WorkspaceRebuildScope = "full",
    document?: vscode.TextDocument,
    uri?: vscode.Uri,
  ): Promise<void> => {
    if (!(await options.safeEnsureBundle(document?.uri ?? uri))) {
      return;
    }
    scheduleWorkspaceSymbolIndexRebuild(
      options.resolveWorkspaceSchema,
      workspaceSymbolSettings(),
      options.getMaxSymbolLines(),
      { scope, document, uri },
    );
  };

  const scheduleForUri = async (uri: vscode.Uri, scope: WorkspaceRebuildScope): Promise<void> => {
    const settings = workspaceSymbolSettings();
    const folder = vscode.workspace.getWorkspaceFolder?.(uri);
    if (
      !isUriIncludedInWorkspaceSymbols(uri, settings, folder) ||
      isUriExcludedFromWorkspaceSymbols(uri, settings, folder)
    ) {
      return;
    }
    await schedule(scope, undefined, uri);
  };

  const onWorkspaceIndexChanged = (event: WorkspaceIndexChangeEvent): void => {
    options.refreshWorkspaceIndexStatusBar();
    const uri = event.document?.uri ?? event.uri;
    const documents = uri ? openHaproxyDocumentsInFolder(uri) : openHaproxyDocuments();
    for (const document of documents) {
      options.scheduler.runNow(document);
    }
  };

  const configureWatchers = (): void => {
    const settings = options.getSettings();
    if (!settings.workspaceSymbolsEnabled) {
      disposeWorkspaceWatchers();
      clearWorkspaceSymbolIndex();
      return;
    }
    const folders =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders
        : [undefined];
    const desiredKeys = new Set<string>();
    const workspaceSettings = workspaceSymbolSettings();
    for (const folder of folders) {
      for (const include of new Set(effectiveWorkspaceSymbolIncludePatterns(workspaceSettings))) {
        const key = JSON.stringify([folder ? workspaceUriKey(folder.uri) : undefined, include]);
        desiredKeys.add(key);
        if (watcherRegistrations.has(key)) {
          continue;
        }
        const onEvent = (uri: vscode.Uri, scope: WorkspaceRebuildScope): void => {
          const owner = vscode.workspace.getWorkspaceFolder?.(uri);
          if (folder && (!owner || workspaceUriKey(owner.uri) !== workspaceUriKey(folder.uri))) {
            return;
          }
          void scheduleForUri(uri, scope);
        };
        const pattern = folder ? new vscode.RelativePattern(folder, include) : include;
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const listeners = [
          watcher.onDidCreate((uri) => onEvent(uri, "full")),
          watcher.onDidChange((uri) => onEvent(uri, "incremental")),
          watcher.onDidDelete((uri) => onEvent(uri, "full")),
        ];
        watcherRegistrations.set(key, {
          watcher,
          listeners,
          dispose() {
            for (const listener of listeners) {
              listener.dispose();
            }
            watcher.dispose();
          },
        });
      }
    }
    for (const [key, registration] of watcherRegistrations) {
      if (!desiredKeys.has(key)) {
        registration.dispose();
        watcherRegistrations.delete(key);
      }
    }
  };

  setWorkspaceSymbolIndexChangeListener(onWorkspaceIndexChanged);

  return {
    configureWatchers,
    handleWorkspaceFoldersChanged() {
      const currentFolders = new Map(
        (vscode.workspace.workspaceFolders ?? []).map((folder) => [
          workspaceUriKey(folder.uri),
          folder,
        ]),
      );
      const added = [...currentFolders].filter(([key]) => !knownFolders.has(key));
      const removed = [...knownFolders].filter(([key]) => !currentFolders.has(key));
      knownFolders = currentFolders;
      if (added.length === 0 && removed.length === 0) {
        return;
      }
      configureWatchers();
      removeWorkspaceSymbolFolders(removed.map(([, folder]) => folder.uri));
      // Adding/removing a nested root also changes ownership in its surviving parent.
      const changedKeys = [...added, ...removed].map(([key]) => key);
      for (const [key, folder] of currentFolders) {
        if (
          added.some(([addedKey]) => addedKey === key) ||
          changedKeys.some((changedKey) => changedKey.startsWith(`${key}/`))
        ) {
          void schedule("full", undefined, folder.uri);
        }
      }
      for (const document of openHaproxyDocuments()) {
        const owner = vscode.workspace.getWorkspaceFolder?.(document.uri);
        const ownerKey = owner ? workspaceUriKey(owner.uri) : undefined;
        if (
          removed.some(
            ([key]) =>
              workspaceUriKey(document.uri).startsWith(`${key}/`) &&
              !ownerKey?.startsWith(`${key}/`),
          )
        ) {
          options.scheduler.runNow(document);
        }
      }
      options.refreshWorkspaceIndexStatusBar();
    },
    schedule,
    scheduleForUri,
    scheduleRebuildWithReadyBundle,
    settings: workspaceSymbolSettings,
    dispose() {
      disposeWorkspaceWatchers();
      setWorkspaceSymbolIndexChangeListener(undefined);
      clearWorkspaceSymbolIndex();
    },
  };
}
