import * as vscode from "vscode";

import { provideCompletionItems } from "./completion";
import { provideDocumentSymbols } from "./documentSymbols";
import { computeDiagnostics } from "./diagnostics";
import { provideFoldingRanges } from "./folding";
import { formatConfig } from "./formatter";
import { promptReloadIfGrammarChanged, syncActiveGrammar } from "./grammar";
import { provideHover } from "./hover";
import { clearLanguageDataCache, HaproxyLanguageData, loadLanguageData } from "./languageData";
import { clearSchemaCache, HaproxySchema, loadSchema } from "./schema";
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

export function activate(context: vscode.ExtensionContext): void {
  registerVersionStatusBar(context);

  const diagnostics = vscode.languages.createDiagnosticCollection("haproxy");
  context.subscriptions.push(diagnostics);

  const ensureBundle = (): Promise<ExtensionBundle> => {
    if (bundle) {
      return Promise.resolve(bundle);
    }
    if (!bundleLoadPromise) {
      bundleLoadPromise = new Promise((resolve) => {
        setImmediate(() => {
          const version = getConfiguredVersion();
          bundle = {
            version,
            schema: loadSchema(context, version),
            languageData: loadLanguageData(context, version),
          };
          resolve(bundle);
        });
      });
    }
    return bundleLoadPromise;
  };

  const runDiagnostics = async (document: vscode.TextDocument): Promise<void> => {
    const settings = getExtensionSettings();
    if (!settings.diagnosticsEnabled || document.languageId !== "haproxy") {
      return;
    }
    if (document.lineCount > settings.maxDiagnosticsLines) {
      diagnostics.set(document.uri, []);
      return;
    }
    const b = await ensureBundle();
    diagnostics.set(document.uri, computeDiagnostics(document, b.schema, {
      languageData: b.languageData,
      deprecatedWarnings: settings.deprecatedWarnings,
    }));
  };

  const scheduleDiagnostics = (document: vscode.TextDocument): void => {
    if (document.languageId !== "haproxy") {
      return;
    }
    const settings = getExtensionSettings();
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
      }, settings.diagnosticsDebounceMs)
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
    bundle = undefined;
    bundleLoadPromise = undefined;
    const b = await ensureBundle();
    if (syncGrammar) {
      const grammarChanged = syncActiveGrammar(context, b.version);
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
      refreshAllDocuments();
    })
  );

  setImmediate(() => {
    void ensureBundle().then((b) => {
      const grammarChanged = syncActiveGrammar(context, b.version);
      void promptReloadIfGrammarChanged(grammarChanged);
    });
    refreshAllDocuments();
  });

  const selector: vscode.DocumentSelector = { language: "haproxy" };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        async provideCompletionItems(document, position) {
          const b = await ensureBundle();
          return provideCompletionItems(document, position, b.languageData, b.schema);
        },
      },
      " ",
      "\t"
    ),
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position) {
        const b = await ensureBundle();
        return provideHover(document, position, b.languageData, b.schema);
      },
    }),
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits(document) {
        const settings = getExtensionSettings();
        if (!settings.formatEnabled) {
          return [];
        }
        const formatted = formatConfig(document.getText(), getFormatOptions(settings));
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
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
    })
  );
}

export function deactivate(): void {
  bundle = undefined;
  bundleLoadPromise = undefined;
}
