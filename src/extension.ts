import * as vscode from "vscode";

import { provideCompletionItems } from "./completion";
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
import { hasWarmUriDocumentCache } from "./documentCache";
import {
  clearWorkspaceSymbolIndex,
  invalidateDiscoveryCache,
  isUriExcludedFromWorkspaceSymbols,
  resolveWorkspaceRebuildScopeOnOpen,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
  WorkspaceIndexChangeEvent,
  WorkspaceRebuildScope,
  WorkspaceSymbolSettings,
} from "./symbolIndex";
import { registerVersionStatusBar } from "./statusBar";
import { registerWorkspaceIndexStatusBar } from "./workspaceIndexStatusBar";
import { getConfiguredVersion, onVersionConfigurationChanged } from "./version";

let activeScheduler: DiagnosticScheduler | undefined;
let workspaceWatchers: vscode.Disposable[] = [];

function disposeWorkspaceWatchers(): void {
  for (const watcher of workspaceWatchers) {
    watcher.dispose();
  }
  workspaceWatchers = [];
}

export function activate(context: vscode.ExtensionContext): void {
  let cachedSettings = getExtensionSettings();
  const refreshWorkspaceIndexStatusBar = registerWorkspaceIndexStatusBar(context);
  registerVersionStatusBar(context);

  const diagnostics = vscode.languages.createDiagnosticCollection("haproxy");
  context.subscriptions.push(diagnostics);

  const { ensureBundle, invalidate: invalidateBundle } = createBundleLoader(
    context,
    getConfiguredVersion,
  );

  let bundleErrorShown = false;
  const reportBundleError = (message: string): void => {
    if (!bundleErrorShown) {
      bundleErrorShown = true;
      void vscode.window.showErrorMessage(`HAProxy extension failed to load schema: ${message}`);
    }
  };

  const ensureBundleResilient = async () => {
    try {
      return await ensureBundle();
    } catch (error) {
      if (isBundleLoadStaleError(error)) {
        return await ensureBundle();
      }
      throw error;
    }
  };

  const safeEnsureBundle = async () => {
    try {
      return await ensureBundleResilient();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportBundleError(message);
      return undefined;
    }
  };

  const scheduler = createDiagnosticScheduler(
    diagnostics,
    () => cachedSettings,
    ensureBundleResilient,
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

  const refreshDocumentsNow = (documents: readonly vscode.TextDocument[]): void => {
    for (const document of documents) {
      scheduler.runNow(document);
    }
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
    debounceMs: cachedSettings.workspaceSymbolsDebounceMs,
  });

  const scheduleWorkspaceSymbols = async (
    scope: WorkspaceRebuildScope = "full",
    document?: vscode.TextDocument,
    uri?: vscode.Uri,
  ): Promise<void> => {
    const b = await safeEnsureBundle();
    if (!b) {
      return;
    }
    scheduleWorkspaceSymbolIndexRebuild(
      b.schema,
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
    refreshDocumentsNow(documents);
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

  const reloadBundle = async (): Promise<void> => {
    invalidateBundle();
    bundleErrorShown = false;
    const b = await safeEnsureBundle();
    if (!b) {
      return;
    }
    await syncAllOpenDocumentGrammarLanguages();
    scheduleWorkspaceSymbolIndexRebuild(
      b.schema,
      workspaceSymbolSettings(),
      cachedSettings.maxDiagnosticsLines,
      { scope: "full" },
    );
    refreshAllDocuments();
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (isHaproxyLanguageId(document.languageId)) {
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
    onVersionConfigurationChanged(() => {
      void reloadBundle();
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
    void safeEnsureBundle().then(async (b) => {
      if (!b) {
        return;
      }
      await syncAllOpenDocumentGrammarLanguages();
      if (
        vscode.workspace.textDocuments.some((document) => isHaproxyLanguageId(document.languageId))
      ) {
        scheduleWorkspaceSymbolIndexRebuild(
          b.schema,
          workspaceSymbolSettings(),
          cachedSettings.maxDiagnosticsLines,
        );
      }
    });
    refreshAllDocuments();
  });

  const selector = haproxyDocumentSelector();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "haproxy.peekDefinitionAtPosition",
      async (uriString: string, line: number, character: number) => {
        const uri = vscode.Uri.parse(uriString);
        const document = await vscode.workspace.openTextDocument(uri);
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
          const b = await safeEnsureBundle();
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
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position) {
        const b = await safeEnsureBundle();
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
        const b = await safeEnsureBundle();
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
        const b = await safeEnsureBundle();
        if (!b) {
          return null;
        }
        const settings = cachedSettings;
        return provideDefinition(document, position, b.schema, settings.maxDiagnosticsLines);
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      async provideReferences(document, position, refContext) {
        const b = await safeEnsureBundle();
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
        const b = await safeEnsureBundle();
        if (!b) {
          return null;
        }
        const settings = cachedSettings;
        return prepareRename(document, position, b.schema, settings.maxDiagnosticsLines);
      },
      async provideRenameEdits(document, position, newName) {
        const b = await safeEnsureBundle();
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
