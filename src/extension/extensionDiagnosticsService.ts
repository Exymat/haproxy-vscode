import * as vscode from "vscode";

import { createDiagnosticScheduler, DiagnosticScheduler } from "../diagnostics/diagnosticScheduler";
import { ExtensionBundle } from "./extensionBundle";
import { refreshDocumentsInFolders } from "./extensionRefresh";
import { HaproxyExtensionSettings } from "./settings";

export interface ExtensionDiagnosticsService extends vscode.Disposable {
  scheduler: DiagnosticScheduler;
  refreshAllDocuments: () => void;
  refreshDocumentsInWorkspaceFolders: (folderUris: readonly (string | undefined)[]) => void;
}

interface ExtensionDiagnosticsServiceOptions {
  getSettings: () => HaproxyExtensionSettings;
  ensureBundle: (document: vscode.TextDocument) => Promise<ExtensionBundle>;
  onBundleError: (message: string) => void;
}

export function createExtensionDiagnosticsService(
  context: vscode.ExtensionContext,
  options: ExtensionDiagnosticsServiceOptions,
): ExtensionDiagnosticsService {
  const diagnostics = vscode.languages.createDiagnosticCollection("haproxy");
  context.subscriptions.push(diagnostics);

  const scheduler = createDiagnosticScheduler(
    diagnostics,
    options.getSettings,
    options.ensureBundle,
    options.onBundleError,
  );

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

  return {
    scheduler,
    refreshAllDocuments,
    refreshDocumentsInWorkspaceFolders,
    dispose() {
      scheduler.clearPending();
    },
  };
}
