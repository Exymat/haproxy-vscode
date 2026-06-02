import * as vscode from "vscode";

import { provideCompletionItems } from "./completion";
import { computeDiagnostics } from "./diagnostics";
import { promptReloadIfGrammarChanged, syncActiveGrammar } from "./grammar";
import { provideHover } from "./hover";
import { clearLanguageDataCache, HaproxyLanguageData, loadLanguageData } from "./languageData";
import { clearSchemaCache, HaproxySchema, loadSchema } from "./schema";
import { getConfiguredVersion, HaproxyVersion, onVersionConfigurationChanged } from "./version";

interface ExtensionBundle {
  version: HaproxyVersion;
  schema: HaproxySchema;
  languageData: HaproxyLanguageData;
}

export function activate(context: vscode.ExtensionContext): void {
  let bundle = loadBundle(context);

  const diagnostics = vscode.languages.createDiagnosticCollection("haproxy");
  context.subscriptions.push(diagnostics);

  const refreshDiagnostics = (document: vscode.TextDocument): void => {
    if (document.languageId !== "haproxy") {
      return;
    }
    diagnostics.set(document.uri, computeDiagnostics(document, bundle.schema));
  };

  const refreshAllDocuments = (): void => {
    vscode.workspace.textDocuments.forEach(refreshDiagnostics);
  };

  const reloadBundle = async (fromConfigChange: boolean): Promise<void> => {
    const previous = bundle.version;
    bundle = loadBundle(context);
    refreshAllDocuments();
    if (fromConfigChange && previous !== bundle.version) {
      const grammarChanged = syncActiveGrammar(context, bundle.version);
      await promptReloadIfGrammarChanged(grammarChanged);
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
    vscode.workspace.onDidChangeTextDocument((event) => refreshDiagnostics(event.document)),
    vscode.workspace.onDidSaveTextDocument(refreshDiagnostics),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
    onVersionConfigurationChanged(() => {
      clearSchemaCache();
      clearLanguageDataCache();
      void reloadBundle(true);
    })
  );

  refreshAllDocuments();

  const selector: vscode.DocumentSelector = { language: "haproxy" };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems(document, position) {
          return provideCompletionItems(document, position, bundle.languageData, bundle.schema);
        },
      },
      " ",
      "\t"
    ),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        return provideHover(document, position, bundle.languageData, bundle.schema);
      },
    })
  );
}

function loadBundle(context: vscode.ExtensionContext): ExtensionBundle {
  const version = getConfiguredVersion();
  syncActiveGrammar(context, version);
  return {
    version,
    schema: loadSchema(context, version),
    languageData: loadLanguageData(context, version),
  };
}

export function deactivate(): void {
  // no-op
}
