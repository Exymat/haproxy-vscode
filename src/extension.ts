import * as vscode from "vscode";

import { provideCompletionItems } from "./completion";
import { provideDocumentSymbols } from "./documentSymbols";
import { createDiagnosticScheduler, DiagnosticScheduler } from "./diagnosticScheduler";
import { provideFoldingRanges } from "./folding";
import { formatConfig } from "./formatter";
import { promptReloadIfGrammarChanged, syncActiveGrammarAsync } from "./grammar";
import { provideHover } from "./hover";
import { provideDefinition, provideReferences } from "./navigation";
import { createBundleLoader, invalidateBundleLoad } from "./extensionBundle";
import { getExtensionSettings, getFormatOptions, onSettingsChanged } from "./settings";
import { registerVersionStatusBar } from "./statusBar";
import { getConfiguredVersion, onVersionConfigurationChanged } from "./version";

let activeScheduler: DiagnosticScheduler | undefined;

export function activate(context: vscode.ExtensionContext): void {
  let cachedSettings = getExtensionSettings();
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

  const reloadBundle = async (syncGrammar: boolean): Promise<void> => {
    invalidateBundle();
    bundleErrorShown = false;
    const b = await safeEnsureBundle();
    if (!b) {
      return;
    }
    if (syncGrammar) {
      const grammarChanged = await syncActiveGrammarAsync(context, b.version);
      await promptReloadIfGrammarChanged(grammarChanged);
    }
    refreshAllDocuments();
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scheduler.schedule),
    vscode.workspace.onDidChangeTextDocument((event) => scheduler.schedule(event.document)),
    vscode.workspace.onDidSaveTextDocument(scheduler.schedule),
    vscode.workspace.onDidCloseTextDocument(scheduler.disposeDocument),
    onVersionConfigurationChanged(() => {
      void reloadBundle(true);
    }),
    onSettingsChanged(() => {
      refreshCachedSettings();
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
    });
    refreshAllDocuments();
  });

  const selector: vscode.DocumentSelector = { language: "haproxy" };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        async provideCompletionItems(document, position) {
          const b = await safeEnsureBundle();
          if (!b) {
            return [];
          }
          return provideCompletionItems(document, position, b.languageData, b.schema);
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
        return provideHover(document, position, b.languageData, b.schema);
      },
    }),
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits(document) {
        const settings = cachedSettings;
        if (!settings.formatEnabled) {
          return [];
        }
        const text = document.getText();
        const formatted = formatConfig(text, getFormatOptions(settings));
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
  );
}

export function deactivate(): void {
  activeScheduler?.clearPending();
  activeScheduler = undefined;
  invalidateBundleLoad();
}
