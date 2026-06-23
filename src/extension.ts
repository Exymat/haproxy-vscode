import * as vscode from "vscode";

import { provideCompletionItems } from "./completion";
import { provideDocumentSymbols } from "./documentSymbols";
import { computeDiagnostics } from "./diagnostics";
import { provideFoldingRanges } from "./folding";
import { formatConfig } from "./formatter";
import { promptReloadIfGrammarChanged, syncActiveGrammarAsync } from "./grammar";
import { provideHover } from "./hover";
import { provideDefinition, provideReferences } from "./navigation";
import { clearLanguageDataCache, HaproxyLanguageData, loadLanguageDataAsync } from "./languageData";
import { clearSchemaCache, HaproxySchema, loadSchemaAsync } from "./schema";
import { getExtensionSettings, getFormatOptions, onSettingsChanged } from "./settings";
import { registerVersionStatusBar } from "./statusBar";
import { getConfiguredVersion, HaproxyVersion, onVersionConfigurationChanged } from "./version";

interface ExtensionBundle {
  version: HaproxyVersion;
  schema: HaproxySchema;
  languageData: HaproxyLanguageData;
}

const pendingDiagnostics = new Map<string, NodeJS.Timeout>();
let bundle: ExtensionBundle | undefined;
let bundleLoadPromise: Promise<ExtensionBundle> | undefined;
let bundleLoadError: Error | undefined;
let bundleErrorShown = false;
let bundleGeneration = 0;
let cachedSettings = getExtensionSettings();

function invalidateBundleLoad(): void {
  bundleGeneration += 1;
  bundle = undefined;
  bundleLoadPromise = undefined;
  bundleLoadError = undefined;
  bundleErrorShown = false;
}

function refreshCachedSettings(): void {
  cachedSettings = getExtensionSettings();
}

function clearPendingDiagnostics(): void {
  for (const timer of pendingDiagnostics.values()) {
    clearTimeout(timer);
  }
  pendingDiagnostics.clear();
}

export function activate(context: vscode.ExtensionContext): void {
  refreshCachedSettings();
  registerVersionStatusBar(context);

  const diagnostics = vscode.languages.createDiagnosticCollection("haproxy");
  context.subscriptions.push(diagnostics);

  const ensureBundle = (): Promise<ExtensionBundle> => {
    if (bundle) {
      return Promise.resolve(bundle);
    }
    if (bundleLoadError) {
      return Promise.reject(bundleLoadError);
    }
    if (!bundleLoadPromise) {
      const generation = bundleGeneration;
      const isStale = (): boolean => generation !== bundleGeneration;
      bundleLoadPromise = new Promise((resolve, reject) => {
        setImmediate(() => {
          void (async () => {
            const version = getConfiguredVersion();
            const loaded = {
              version,
              schema: await loadSchemaAsync(context, version),
              languageData: await loadLanguageDataAsync(context, version),
            };
            if (isStale()) {
              return;
            }
            bundle = loaded;
            resolve(loaded);
          })().catch((error) => {
            /* c8 ignore next 3 -- stale load discarded after deactivate/reload */
            if (isStale()) {
              return;
            }
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        });
      });
      /* c8 ignore next 4 -- defensive recovery path for transient async load failures */
      bundleLoadPromise = bundleLoadPromise.catch((error) => {
        if (isStale()) {
          throw error;
        }
        bundleLoadPromise = undefined;
        bundleLoadError = error instanceof Error ? error : new Error(String(error));
        throw bundleLoadError;
      });
    }
    return bundleLoadPromise;
  };

  const safeEnsureBundle = async (): Promise<ExtensionBundle | undefined> => {
    try {
      return await ensureBundle();
    } catch (error) {
      if (!bundleErrorShown) {
        bundleErrorShown = true;
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`HAProxy extension failed to load schema: ${message}`);
      }
      return undefined;
    }
  };

  const runDiagnostics = async (document: vscode.TextDocument): Promise<void> => {
    const settings = cachedSettings;
    if (!settings.diagnosticsEnabled || document.languageId !== "haproxy") {
      return;
    }
    if (document.lineCount > settings.maxDiagnosticsLines) {
      diagnostics.set(document.uri, []);
      return;
    }
    const b = await safeEnsureBundle();
    if (!b) {
      diagnostics.set(document.uri, []);
      return;
    }
    diagnostics.set(
      document.uri,
      computeDiagnostics(document, b.schema, {
        languageData: b.languageData,
        deprecatedWarnings: settings.deprecatedWarnings,
        unusedSymbols: settings.unusedSymbols,
        unusedSymbolSections: settings.unusedSymbolSections,
        maxLines: settings.maxDiagnosticsLines,
      }),
    );
  };

  const scheduleDiagnostics = (document: vscode.TextDocument): void => {
    if (document.languageId !== "haproxy") {
      return;
    }
    const settings = cachedSettings;
    if (!settings.diagnosticsEnabled) {
      diagnostics.delete(document.uri);
      return;
    }
    const key = document.uri.toString();
    const existing = pendingDiagnostics.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    pendingDiagnostics.set(
      key,
      setTimeout(() => {
        pendingDiagnostics.delete(key);
        void runDiagnostics(document);
      }, settings.diagnosticsDebounceMs),
    );
  };

  const refreshAllDocuments = (): void => {
    for (const document of vscode.workspace.textDocuments) {
      scheduleDiagnostics(document);
    }
  };

  const reloadBundle = async (syncGrammar: boolean): Promise<void> => {
    clearSchemaCache();
    clearLanguageDataCache();
    invalidateBundleLoad();
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
    vscode.workspace.onDidOpenTextDocument(scheduleDiagnostics),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleDiagnostics(event.document)),
    vscode.workspace.onDidSaveTextDocument(scheduleDiagnostics),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const pending = pendingDiagnostics.get(key);
      if (pending) {
        clearTimeout(pending);
        pendingDiagnostics.delete(key);
      }
      diagnostics.delete(doc.uri);
    }),
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
      async provideReferences(document, position, context) {
        const b = await safeEnsureBundle();
        if (!b) {
          return [];
        }
        const settings = cachedSettings;
        return provideReferences(
          document,
          position,
          context,
          b.schema,
          settings.maxDiagnosticsLines,
        );
      },
    }),
  );
}

export function deactivate(): void {
  clearPendingDiagnostics();
  invalidateBundleLoad();
}
