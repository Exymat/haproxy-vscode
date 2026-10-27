/** Registers settings, version, and document lifecycle hooks for the extension. */
import * as vscode from "vscode";

import { hasWarmUriDocumentCache } from "../parser/documentCache";
import { finalizeParseCacheForClosedDocument } from "../parser/parseCache";
import { finalizeDiagnosticsCacheForClosedDocument } from "../diagnostics";
import { ExtensionBundleService } from "./extensionBundleService";
import { ExtensionDiagnosticsService } from "./extensionDiagnosticsService";
import { ExtensionWorkspaceSymbolService } from "./extensionWorkspaceSymbols";
import {
  isHaproxyLanguageId,
  syncAllOpenDocumentGrammarLanguages,
  syncDocumentGrammarLanguage,
} from "./grammar";
import {
  beginTextDocumentOpen,
  considerPlaintextEdit,
  noteTextDocumentClosed,
  promoteOpenPlaintextDocuments,
  promotePlaintextDocument,
  resetLanguagePromotionState,
} from "./languagePromotion";
import { logConfiguredVersion, logSupportSnapshot } from "./outputChannel";
import { HaproxyExtensionSettings, onSettingsChanged } from "./settings";
import { resolveWorkspaceRebuildScopeOnOpen } from "../symbolIndex";
import {
  getConfiguredVersionForUri,
  HaproxyVersion,
  onVersionConfigurationChanged,
  VersionConfigurationChange,
} from "./version";

interface ExtensionLifecycleOptions {
  context: vscode.ExtensionContext;
  extensionVersion: string;
  getSettings: () => HaproxyExtensionSettings;
  refreshSettings: () => void;
  diagnostics: ExtensionDiagnosticsService;
  bundle: ExtensionBundleService;
  workspaceSymbols: ExtensionWorkspaceSymbolService;
}

export function registerExtensionLifecycle(options: ExtensionLifecycleOptions): void {
  const { context, extensionVersion, refreshSettings, bundle, diagnostics, workspaceSymbols } =
    options;
  const { scheduler } = diagnostics;
  resetLanguagePromotionState();

  const logSupportSnapshotIfReady = (bundleVersion: HaproxyVersion): void => {
    logSupportSnapshot({
      extensionVersion,
      bundleVersion,
      workspaceSymbolSettings: workspaceSymbols.settings(),
    });
  };

  const reloadBundleForChange = async (change: VersionConfigurationChange): Promise<void> => {
    for (const version of change.versions) {
      bundle.invalidate(version);
    }
    bundle.resetErrorReporting();
    for (const folderUri of change.affectedFolderUris) {
      const uri = folderUri ? vscode.Uri.parse(folderUri) : undefined;
      logConfiguredVersion(getConfiguredVersionForUri(uri), "config-change", uri);
    }
    await syncAllOpenDocumentGrammarLanguages();
    for (const folderUri of change.affectedFolderUris) {
      const loadedBundle = folderUri
        ? await bundle.safeEnsureBundle(vscode.Uri.parse(folderUri))
        : await bundle.safeEnsureBundle();
      if (loadedBundle) {
        logSupportSnapshotIfReady(loadedBundle.version);
      }
      if (folderUri) {
        await workspaceSymbols.scheduleForUri(vscode.Uri.parse(folderUri), "full");
      } else {
        await workspaceSymbols.schedule("full");
      }
    }
    diagnostics.refreshDocumentsInWorkspaceFolders(change.affectedFolderUris);
  };

  const handleHaproxyDocumentOpened = (document: vscode.TextDocument): void => {
    logConfiguredVersion(getConfiguredVersionForUri(document.uri), "document-open", document.uri);
    void syncDocumentGrammarLanguage(document);
    const scope = resolveWorkspaceRebuildScopeOnOpen(document);
    if (scope !== "none") {
      void workspaceSymbols.schedule(scope, document);
    }
    if (hasWarmUriDocumentCache(document)) {
      scheduler.runNow(document);
      return;
    }
    scheduler.schedule(document);
  };

  const onTextDocumentOpened = async (document: vscode.TextDocument): Promise<void> => {
    const disposition = beginTextDocumentOpen(document);
    if (disposition === "haproxy") {
      handleHaproxyDocumentOpened(document);
      return;
    }
    if (disposition === "promote") {
      const promoted = await promotePlaintextDocument(document);
      if (!promoted) {
        scheduler.schedule(document);
      }
      return;
    }
    scheduler.schedule(document);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void onTextDocumentOpened(document);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduler.schedule(event.document);
      if (isHaproxyLanguageId(event.document.languageId)) {
        void workspaceSymbols.schedule("incremental", event.document);
        return;
      }
      considerPlaintextEdit(event.document);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      scheduler.schedule(document);
      if (isHaproxyLanguageId(document.languageId)) {
        void workspaceSymbols.schedule("content", document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      noteTextDocumentClosed(document);
      finalizeParseCacheForClosedDocument(document);
      finalizeDiagnosticsCacheForClosedDocument(document);
      scheduler.disposeDocument(document);
    }),
    onVersionConfigurationChanged((change) => {
      void reloadBundleForChange(change);
    }),
    onSettingsChanged(() => {
      refreshSettings();
      workspaceSymbols.configureWatchers();
      void workspaceSymbols.schedule("full");
      diagnostics.refreshAllDocuments();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      workspaceSymbols.handleWorkspaceFoldersChanged();
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
        const loadedBundle = await bundle.safeEnsureBundle(document.uri);
        if (!loadedBundle) {
          return;
        }
        logSupportSnapshotIfReady(loadedBundle.version);
      }
      await syncAllOpenDocumentGrammarLanguages();
      workspaceSymbols.scheduleRebuildWithReadyBundle("full");
    })();
    diagnostics.refreshAllDocuments();
  });

  promoteOpenPlaintextDocuments();
}
