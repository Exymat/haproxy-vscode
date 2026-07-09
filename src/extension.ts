import * as vscode from "vscode";

import { provideCompletionItems } from "./completion";
import { provideDiagnosticSuppressionCodeActions } from "./diagnosticCodeActions";
import { provideDocumentSymbols } from "./documentSymbols";
import { createDiagnosticScheduler, DiagnosticScheduler } from "./diagnosticScheduler";
import { provideFoldingRanges } from "./folding";
import { formatConfig } from "./formatter";
import {
  haproxyDocumentSelector,
  isHaproxyLanguageId,
  syncAllOpenDocumentGrammarLanguages,
  syncDocumentGrammarLanguage,
} from "./grammar";
import { refreshDocumentsInFolders } from "./extensionRefresh";
import { provideHover } from "./hover";
import { provideDefinition, provideReferences } from "./navigation";
import { prepareRename, provideRenameEdits } from "./rename";
import {
  createBundleLoader,
  invalidateBundleLoad,
  isBundleLoadStaleError,
} from "./extensionBundle";
import { getExtensionSettings, getFormatOptions, onSettingsChanged } from "./settings";
import { sectionHeaderSet } from "./schema";
import {
  logConfiguredVersion,
  logExtensionActivated,
  logSupportSnapshot,
  registerHaproxyOutputChannel,
} from "./outputChannel";
import { hasWarmUriDocumentCache } from "./documentCache";
import {
  clearWorkspaceSymbolIndex,
  getWorkspaceSymbolIndex,
  invalidateDiscoveryCache,
  isUriExcludedFromWorkspaceSymbols,
  resolveWorkspaceRebuildScopeOnOpen,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
  WorkspaceIndexChangeEvent,
  WorkspaceRebuildScope,
  WorkspaceSymbolSettings,
  workspaceUriKey,
} from "./symbolIndex";
import { registerVersionStatusBar } from "./statusBar";
import { registerWorkspaceIndexStatusBar } from "./workspaceIndexStatusBar";
import {
  getConfiguredVersionForUri,
  HaproxyVersion,
  onVersionConfigurationChanged,
  VersionConfigurationChange,
} from "./version";

let activeScheduler: DiagnosticScheduler | undefined;
let workspaceWatchers: vscode.Disposable[] = [];

function disposeWorkspaceWatchers(): void {
  for (const watcher of workspaceWatchers) {
    watcher.dispose();
  }
  workspaceWatchers = [];
}

export function activate(context: vscode.ExtensionContext): void {
  const extensionVersion = (context.extension.packageJSON as { version: string }).version;
  registerHaproxyOutputChannel(context);
  logExtensionActivated(extensionVersion);

  let cachedSettings = getExtensionSettings();
  const refreshWorkspaceIndexStatusBar = registerWorkspaceIndexStatusBar(context);
  registerVersionStatusBar(context);

  const diagnostics = vscode.languages.createDiagnosticCollection("haproxy");
  context.subscriptions.push(diagnostics);

  const { ensureBundleForUri, invalidate: invalidateBundle } = createBundleLoader(context);

  let bundleErrorShown = false;
  const reportBundleError = (message: string): void => {
    if (!bundleErrorShown) {
      bundleErrorShown = true;
      void vscode.window.showErrorMessage(`HAProxy extension failed to load schema: ${message}`);
    }
  };

  const ensureBundleResilient = async (uri?: vscode.Uri) => {
    try {
      return await ensureBundleForUri(uri);
    } catch (error) {
      if (isBundleLoadStaleError(error)) {
        return await ensureBundleForUri(uri);
      }
      throw error;
    }
  };

  const safeEnsureBundle = async (uri?: vscode.Uri) => {
    try {
      return await ensureBundleResilient(uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportBundleError(message);
      return undefined;
    }
  };

  const resolveWorkspaceSchema = async (folder: vscode.WorkspaceFolder | undefined) => {
    const bundle = await safeEnsureBundle(folder?.uri);
    if (!bundle) {
      throw new Error("HAProxy schema bundle is unavailable");
    }
    return bundle.schema;
  };

  const scheduler = createDiagnosticScheduler(
    diagnostics,
    () => cachedSettings,
    (document) => ensureBundleResilient(document.uri),
    reportBundleError,
  );

  activeScheduler = scheduler;

  const refreshCachedSettings = (): void => {
    cachedSettings = getExtensionSettings();
  };

  const refreshAllDocuments = (): void => {
    for (const document of vscode.workspace.textDocuments) {
      scheduler.schedule(document);
    }
  };

  const refreshDocumentsInWorkspaceFolders = (
    folderUris: readonly (string | undefined)[],
  ): void => {
    refreshDocumentsInFolders(folderUris, vscode.workspace.textDocuments, (document) =>
      scheduler.schedule(document),
    );
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

  const workspaceSymbolSettings = (): WorkspaceSymbolSettings => ({
    enabled: cachedSettings.workspaceSymbolsEnabled,
    include: cachedSettings.workspaceSymbolsInclude,
    exclude: cachedSettings.workspaceSymbolsExclude,
    maxFiles: cachedSettings.workspaceSymbolsMaxFiles,
    maxTotalLines: cachedSettings.workspaceSymbolsMaxTotalLines,
    maxFileBytes: cachedSettings.workspaceSymbolsMaxFileBytes,
    maxTotalBytes: cachedSettings.workspaceSymbolsMaxTotalBytes,
    maxLineBytes: cachedSettings.workspaceSymbolsMaxLineBytes,
    debounceMs: cachedSettings.workspaceSymbolsDebounceMs,
  });

  const logSupportSnapshotIfReady = (bundleVersion: HaproxyVersion): void => {
    logSupportSnapshot({
      extensionVersion,
      bundleVersion,
      workspaceSymbolSettings: workspaceSymbolSettings(),
    });
  };

  const scheduleWorkspaceSymbols = async (
    scope: WorkspaceRebuildScope = "full",
    document?: vscode.TextDocument,
    uri?: vscode.Uri,
  ): Promise<void> => {
    if (!(await safeEnsureBundle(document?.uri ?? uri))) {
      return;
    }
    scheduleWorkspaceSymbolIndexRebuild(
      resolveWorkspaceSchema,
      workspaceSymbolSettings(),
      cachedSettings.maxDiagnosticsLines,
      { scope, document, uri },
    );
  };

  const scheduleWorkspaceSymbolsForUri = async (
    uri: vscode.Uri,
    scope: WorkspaceRebuildScope,
  ): Promise<void> => {
    const settings = workspaceSymbolSettings();
    const folder = vscode.workspace.getWorkspaceFolder?.(uri);
    if (isUriExcludedFromWorkspaceSymbols(uri, settings, folder)) {
      return;
    }
    await scheduleWorkspaceSymbols(scope, undefined, uri);
  };

  const onWorkspaceIndexChanged = (event: WorkspaceIndexChangeEvent): void => {
    refreshWorkspaceIndexStatusBar();
    if (event.scope === "incremental" && event.document) {
      const folderDocs = openHaproxyDocumentsInFolder(event.document.uri);
      const changedUri = event.document.uri.toString();
      for (const document of folderDocs) {
        if (document.uri.toString() === changedUri) {
          scheduler.runNow(document);
        } else {
          scheduler.schedule(document);
        }
      }
      return;
    }

    const documents = event.document
      ? openHaproxyDocumentsInFolder(event.document.uri)
      : openHaproxyDocuments();
    for (const document of documents) {
      scheduler.runNow(document);
    }
  };

  const configureWorkspaceWatchers = (): void => {
    disposeWorkspaceWatchers();
    if (!cachedSettings.workspaceSymbolsEnabled) {
      clearWorkspaceSymbolIndex();
      return;
    }
    const folders =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders
        : [undefined];
    for (const folder of folders) {
      for (const include of cachedSettings.workspaceSymbolsInclude) {
        const pattern = folder ? new vscode.RelativePattern(folder, include) : include;
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        workspaceWatchers.push(watcher);
        watcher.onDidCreate((uri) => void scheduleWorkspaceSymbolsForUri(uri, "full"));
        watcher.onDidChange((uri) => void scheduleWorkspaceSymbolsForUri(uri, "content"));
        watcher.onDidDelete((uri) => void scheduleWorkspaceSymbolsForUri(uri, "full"));
      }
    }
  };

  setWorkspaceSymbolIndexChangeListener(onWorkspaceIndexChanged);
  configureWorkspaceWatchers();

  const reloadBundleForChange = async (change: VersionConfigurationChange): Promise<void> => {
    for (const version of change.versions) {
      invalidateBundle(version);
    }
    bundleErrorShown = false;
    for (const folderUri of change.affectedFolderUris) {
      const uri = folderUri ? vscode.Uri.parse(folderUri) : undefined;
      logConfiguredVersion(getConfiguredVersionForUri(uri), "config-change", uri);
    }
    await syncAllOpenDocumentGrammarLanguages();
    for (const folderUri of change.affectedFolderUris) {
      const bundle = folderUri
        ? await safeEnsureBundle(vscode.Uri.parse(folderUri))
        : await safeEnsureBundle();
      if (bundle) {
        logSupportSnapshotIfReady(bundle.version);
      }
      if (folderUri) {
        /* v8 ignore next -- covered by integration suite 08-folder-scoped-version */
        await scheduleWorkspaceSymbolsForUri(vscode.Uri.parse(folderUri), "full");
      } else {
        await scheduleWorkspaceSymbols("full");
      }
    }
    refreshDocumentsInWorkspaceFolders(change.affectedFolderUris);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (isHaproxyLanguageId(document.languageId)) {
        logConfiguredVersion(
          getConfiguredVersionForUri(document.uri),
          "document-open",
          document.uri,
        );
        void syncDocumentGrammarLanguage(document);
        const scope = resolveWorkspaceRebuildScopeOnOpen(document);
        if (scope !== "none") {
          void scheduleWorkspaceSymbols(scope, document);
        }
        if (hasWarmUriDocumentCache(document)) {
          scheduler.runNow(document);
        } else {
          scheduler.schedule(document);
        }
        return;
      }
      scheduler.schedule(document);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduler.schedule(event.document);
      if (isHaproxyLanguageId(event.document.languageId)) {
        void scheduleWorkspaceSymbols("incremental", event.document);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      scheduler.schedule(document);
      if (isHaproxyLanguageId(document.languageId)) {
        void scheduleWorkspaceSymbols("content", document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument(scheduler.disposeDocument),
    onVersionConfigurationChanged((change) => {
      void reloadBundleForChange(change);
    }),
    onSettingsChanged(() => {
      refreshCachedSettings();
      configureWorkspaceWatchers();
      void scheduleWorkspaceSymbols("full");
      refreshAllDocuments();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      configureWorkspaceWatchers();
      invalidateDiscoveryCache();
      void scheduleWorkspaceSymbols("full");
    }),
  );

  setImmediate(() => {
    void (async () => {
      const openHaproxyDocs = vscode.workspace.textDocuments.filter((document) =>
        isHaproxyLanguageId(document.languageId),
      );
      if (openHaproxyDocs.length === 0) {
        return;
      }
      for (const document of openHaproxyDocs) {
        const bundle = await safeEnsureBundle(document.uri);
        if (!bundle) {
          return;
        }
        logSupportSnapshotIfReady(bundle.version);
      }
      await syncAllOpenDocumentGrammarLanguages();
      scheduleWorkspaceSymbolIndexRebuild(
        resolveWorkspaceSchema,
        workspaceSymbolSettings(),
        cachedSettings.maxDiagnosticsLines,
      );
    })();
    refreshAllDocuments();
  });

  const selector = haproxyDocumentSelector();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "haproxy.peekDefinitionAtPosition",
      async (uriString: string, line: number, character: number) => {
        if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0) {
          return;
        }
        const uri = vscode.Uri.parse(uriString);
        if (uri.scheme !== "file") {
          return;
        }
        const document = await vscode.workspace.openTextDocument(uri);
        const workspaceIndex = getWorkspaceSymbolIndex(document);
        if (workspaceIndex && !workspaceIndex.documents.has(workspaceUriKey(uri))) {
          return;
        }
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const position = new vscode.Position(line, character);
        editor.selection = new vscode.Selection(position, position);
        await vscode.commands.executeCommand("editor.action.peekDefinition");
      },
    ),
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        async provideCompletionItems(document, position) {
          const b = await safeEnsureBundle(document.uri);
          if (!b) {
            return [];
          }
          return provideCompletionItems(
            document,
            position,
            b.languageData,
            b.schema,
            cachedSettings.maxDiagnosticsLines,
          );
        },
      },
      " ",
      "\t",
    ),
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        provideCodeActions(document, _range, context) {
          return provideDiagnosticSuppressionCodeActions(document, context);
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position) {
        const b = await safeEnsureBundle(document.uri);
        if (!b) {
          return null;
        }
        return provideHover(
          document,
          position,
          b.languageData,
          b.schema,
          cachedSettings.maxDiagnosticsLines,
        );
      },
    }),
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      async provideDocumentFormattingEdits(document) {
        const settings = cachedSettings;
        if (!settings.formatEnabled) {
          return [];
        }
        const b = await safeEnsureBundle(document.uri);
        if (!b) {
          return [];
        }
        const text = document.getText();
        const formatted = formatConfig(text, {
          ...getFormatOptions(settings),
          sectionHeaders: sectionHeaderSet(b.schema),
        });
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(text.length),
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
      },
    }),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(document) {
        return provideDocumentSymbols(document);
      },
    }),
    vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges(document) {
        return provideFoldingRanges(document);
      },
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position) {
        const b = await safeEnsureBundle(document.uri);
        if (!b) {
          return null;
        }
        const settings = cachedSettings;
        return provideDefinition(document, position, b.schema, settings.maxDiagnosticsLines);
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      async provideReferences(document, position, refContext) {
        const b = await safeEnsureBundle(document.uri);
        if (!b) {
          return [];
        }
        const settings = cachedSettings;
        return provideReferences(
          document,
          position,
          refContext,
          b.schema,
          settings.maxDiagnosticsLines,
        );
      },
    }),
    vscode.languages.registerRenameProvider(selector, {
      async prepareRename(document, position) {
        const b = await safeEnsureBundle(document.uri);
        if (!b) {
          return null;
        }
        const settings = cachedSettings;
        return prepareRename(document, position, b.schema, settings.maxDiagnosticsLines);
      },
      async provideRenameEdits(document, position, newName) {
        const b = await safeEnsureBundle(document.uri);
        if (!b) {
          return null;
        }
        const settings = cachedSettings;
        return provideRenameEdits(
          document,
          position,
          newName,
          b.schema,
          settings.maxDiagnosticsLines,
        );
      },
    }),
  );
}

export function deactivate(): void {
  activeScheduler?.clearPending();
  activeScheduler = undefined;
  disposeWorkspaceWatchers();
  setWorkspaceSymbolIndexChangeListener(undefined);
  clearWorkspaceSymbolIndex();
  invalidateBundleLoad();
}
