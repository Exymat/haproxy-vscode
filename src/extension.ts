import * as vscode from "vscode";

import { provideCompletionItems } from "./completion";
import { provideDocumentSymbols } from "./documentSymbols";
import { createDiagnosticScheduler, DiagnosticScheduler } from "./diagnosticScheduler";
import { provideFoldingRanges } from "./folding";
import { formatConfig } from "./formatter";
import { promptReloadIfGrammarChanged, syncActiveGrammarAsync } from "./grammar";
import { provideHover } from "./hover";
import { provideDefinition, provideReferences } from "./navigation";
import { prepareRename, provideRenameEdits } from "./rename";
import { createBundleLoader, getLoadedBundle, invalidateBundleLoad } from "./extensionBundle";
import { getExtensionSettings, getFormatOptions, onSettingsChanged } from "./settings";
import { sectionHeaderSet } from "./schema";
import {
  clearWorkspaceSymbolIndex,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
  WorkspaceSymbolSettings,
} from "./symbolIndex";
import { registerVersionStatusBar } from "./statusBar";
import { getConfiguredVersion, onVersionConfigurationChanged } from "./version";

let activeScheduler: DiagnosticScheduler | undefined;

export function activate(context: vscode.ExtensionContext): void {
  let cachedSettings = getExtensionSettings();
  let workspaceWatchers: vscode.Disposable[] = [];
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

  const safeEnsureBundle = async () => {
    try {
      return await ensureBundle();
    } catch (error) {
      /* v8 ignore next -- non-Error throws are normalized defensively for VS Code host failures */
      const message = error instanceof Error ? error.message : String(error);
      reportBundleError(message);
      return undefined;
    }
  };

  const scheduler = createDiagnosticScheduler(
    diagnostics,
    () => cachedSettings,
    ensureBundle,
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

  const workspaceSymbolSettings = (): WorkspaceSymbolSettings => ({
    enabled: cachedSettings.workspaceSymbolsEnabled,
    include: cachedSettings.workspaceSymbolsInclude,
    exclude: cachedSettings.workspaceSymbolsExclude,
    maxFiles: cachedSettings.workspaceSymbolsMaxFiles,
    maxTotalLines: cachedSettings.workspaceSymbolsMaxTotalLines,
    debounceMs: cachedSettings.workspaceSymbolsDebounceMs,
  });

  const scheduleWorkspaceSymbols = async (): Promise<void> => {
    const b = await safeEnsureBundle();
    if (!b) {
      return;
    }
    scheduleWorkspaceSymbolIndexRebuild(
      b.schema,
      workspaceSymbolSettings(),
      cachedSettings.maxDiagnosticsLines,
    );
  };

  const disposeWorkspaceWatchers = (): void => {
    for (const watcher of workspaceWatchers) {
      watcher.dispose();
    }
    workspaceWatchers = [];
  };

  const configureWorkspaceWatchers = (): void => {
    disposeWorkspaceWatchers();
    if (!cachedSettings.workspaceSymbolsEnabled) {
      /* v8 ignore start -- covered by extension-host behavior; unit mocks keep workspace symbols enabled. */
      clearWorkspaceSymbolIndex();
      return;
      /* v8 ignore stop */
    }
    for (const include of cachedSettings.workspaceSymbolsInclude) {
      const watcher = vscode.workspace.createFileSystemWatcher(include);
      workspaceWatchers.push(watcher);
      context.subscriptions.push(watcher);
      /* v8 ignore start -- VS Code file watcher callbacks are exercised by integration tests. */
      watcher.onDidCreate(() => void scheduleWorkspaceSymbols());
      watcher.onDidChange(() => void scheduleWorkspaceSymbols());
      watcher.onDidDelete(() => void scheduleWorkspaceSymbols());
      /* v8 ignore stop */
    }
  };

  setWorkspaceSymbolIndexChangeListener(refreshAllDocuments);
  configureWorkspaceWatchers();

  const reloadBundle = async (syncGrammar: boolean): Promise<void> => {
    invalidateBundle();
    bundleErrorShown = false;
    const b = await safeEnsureBundle();
    if (!b) {
      return;
    }
    /* v8 ignore next -- some reload paths intentionally skip grammar sync when only settings change */
    if (syncGrammar) {
      const grammarChanged = await syncActiveGrammarAsync(context, b.version);
      await promptReloadIfGrammarChanged(grammarChanged);
    }
    scheduleWorkspaceSymbolIndexRebuild(
      b.schema,
      workspaceSymbolSettings(),
      cachedSettings.maxDiagnosticsLines,
    );
    refreshAllDocuments();
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      scheduler.schedule(document);
      if (document.languageId === "haproxy") {
        void scheduleWorkspaceSymbols();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduler.schedule(event.document);
      if (event.document.languageId === "haproxy") {
        void scheduleWorkspaceSymbols();
      }
    }),
    /* v8 ignore start -- save events are exercised by integration tests, not the unit mock. */
    vscode.workspace.onDidSaveTextDocument((document) => {
      scheduler.schedule(document);
      if (document.languageId === "haproxy") {
        void scheduleWorkspaceSymbols();
      }
    }),
    /* v8 ignore stop */
    vscode.workspace.onDidCloseTextDocument(scheduler.disposeDocument),
    onVersionConfigurationChanged(() => {
      void reloadBundle(true);
    }),
    onSettingsChanged(() => {
      refreshCachedSettings();
      configureWorkspaceWatchers();
      void scheduleWorkspaceSymbols();
      refreshAllDocuments();
    }),
  );

  setImmediate(() => {
    void safeEnsureBundle().then(async (b) => {
      if (!b) {
        return;
      }
      const grammarChanged = await syncActiveGrammarAsync(context, b.version);
      await promptReloadIfGrammarChanged(grammarChanged);
      if (vscode.workspace.textDocuments.some((document) => document.languageId === "haproxy")) {
        scheduleWorkspaceSymbolIndexRebuild(
          b.schema,
          workspaceSymbolSettings(),
          cachedSettings.maxDiagnosticsLines,
        );
      }
    });
    refreshAllDocuments();
  });

  const selector: vscode.DocumentSelector = { language: "haproxy" };

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
      provideDocumentFormattingEdits(document) {
        const settings = cachedSettings;
        if (!settings.formatEnabled) {
          return [];
        }
        const loadedBundle = getLoadedBundle();
        const text = document.getText();
        const formatted = formatConfig(text, {
          ...getFormatOptions(settings),
          /* v8 ignore next -- formatting still works before the async bundle finishes loading */
          sectionHeaders: loadedBundle ? sectionHeaderSet(loadedBundle.schema) : undefined,
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
  setWorkspaceSymbolIndexChangeListener(undefined);
  clearWorkspaceSymbolIndex();
  invalidateBundleLoad();
}
