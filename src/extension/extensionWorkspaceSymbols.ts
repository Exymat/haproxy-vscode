import * as vscode from "vscode";

import { DiagnosticScheduler } from "../diagnostics/diagnosticScheduler";
import { ExtensionBundle } from "./extensionBundle";
import { isHaproxyLanguageId } from "./grammar";
import { HaproxyExtensionSettings } from "./settings";
import {
  clearWorkspaceSymbolIndex,
  invalidateDiscoveryCache,
  isUriExcludedFromWorkspaceSymbols,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
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
  getMaxDiagnosticsLines: () => number;
  resolveWorkspaceSchema: WorkspaceSchemaSource;
  safeEnsureBundle: (uri?: vscode.Uri) => Promise<ExtensionBundle | undefined>;
  scheduler: DiagnosticScheduler;
  refreshWorkspaceIndexStatusBar: () => void;
}

export function createExtensionWorkspaceSymbolService(
  options: ExtensionWorkspaceSymbolServiceOptions,
): ExtensionWorkspaceSymbolService {
  let watcherRegistrations: WorkspaceWatcherRegistration[] = [];

  const disposeWorkspaceWatchers = (): void => {
    for (const registration of watcherRegistrations) {
      registration.dispose();
    }
    watcherRegistrations = [];
  };

  const workspaceSymbolSettings = (): WorkspaceSymbolSettings => {
    const settings = options.getSettings();
    return {
      enabled: settings.workspaceSymbolsEnabled,
      include: settings.workspaceSymbolsInclude,
      exclude: settings.workspaceSymbolsExclude,
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
      return openHaproxyDocuments();
    }
    const folderUri = folder.uri.toString();
    return openHaproxyDocuments().filter(
      (document) =>
        vscode.workspace.getWorkspaceFolder?.(document.uri)?.uri.toString() === folderUri,
    );
  };

  const scheduleRebuildWithReadyBundle = (scope: WorkspaceRebuildScope = "full"): void => {
    scheduleWorkspaceSymbolIndexRebuild(
      options.resolveWorkspaceSchema,
      workspaceSymbolSettings(),
      options.getMaxDiagnosticsLines(),
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
      options.getMaxDiagnosticsLines(),
      { scope, document, uri },
    );
  };

  const scheduleForUri = async (uri: vscode.Uri, scope: WorkspaceRebuildScope): Promise<void> => {
    const settings = workspaceSymbolSettings();
    const folder = vscode.workspace.getWorkspaceFolder?.(uri);
    if (isUriExcludedFromWorkspaceSymbols(uri, settings, folder)) {
      return;
    }
    await schedule(scope, undefined, uri);
  };

  const onWorkspaceIndexChanged = (event: WorkspaceIndexChangeEvent): void => {
    options.refreshWorkspaceIndexStatusBar();
    if (event.scope === "incremental" && event.document) {
      const folderDocs = openHaproxyDocumentsInFolder(event.document.uri);
      const changedUri = event.document.uri.toString();
      for (const document of folderDocs) {
        if (document.uri.toString() === changedUri) {
          options.scheduler.runNow(document);
        } else {
          options.scheduler.schedule(document);
        }
      }
      return;
    }

    const documents = event.document
      ? openHaproxyDocumentsInFolder(event.document.uri)
      : openHaproxyDocuments();
    for (const document of documents) {
      options.scheduler.runNow(document);
    }
  };

  const configureWatchers = (): void => {
    disposeWorkspaceWatchers();
    const settings = options.getSettings();
    if (!settings.workspaceSymbolsEnabled) {
      clearWorkspaceSymbolIndex();
      return;
    }
    const folders =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders
        : [undefined];
    for (const folder of folders) {
      for (const include of settings.workspaceSymbolsInclude) {
        const pattern = folder ? new vscode.RelativePattern(folder, include) : include;
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const listeners = [
          watcher.onDidCreate((uri) => void scheduleForUri(uri, "full")),
          watcher.onDidChange((uri) => void scheduleForUri(uri, "content")),
          watcher.onDidDelete((uri) => void scheduleForUri(uri, "full")),
        ];
        watcherRegistrations.push({
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
  };

  setWorkspaceSymbolIndexChangeListener(onWorkspaceIndexChanged);

  return {
    configureWatchers,
    handleWorkspaceFoldersChanged() {
      configureWatchers();
      invalidateDiscoveryCache();
      void schedule("full");
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
