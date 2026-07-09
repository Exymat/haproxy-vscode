import * as vscode from "vscode";

import { computeDiagnostics } from "./diagnostics";
import { isHaproxyLanguageId } from "./grammar";
import { ExtensionBundle } from "./extensionBundle";
import { HaproxyExtensionSettings } from "./settings";

export interface DiagnosticScheduler {
  schedule: (document: vscode.TextDocument) => void;
  runNow: (document: vscode.TextDocument) => void;
  clearPending: () => void;
  disposeDocument: (document: vscode.TextDocument) => void;
}

export function createDiagnosticScheduler(
  diagnostics: vscode.DiagnosticCollection,
  getSettings: () => HaproxyExtensionSettings,
  ensureBundle: () => Promise<ExtensionBundle>,
  onBundleError: (message: string) => void,
): DiagnosticScheduler {
  const pendingDiagnostics = new Map<string, NodeJS.Timeout>();

  const clearPending = (): void => {
    for (const timer of pendingDiagnostics.values()) {
      clearTimeout(timer);
    }
    pendingDiagnostics.clear();
  };

  const runDiagnostics = async (document: vscode.TextDocument): Promise<void> => {
    const versionAtStart = document.version;
    const settings = getSettings();
    if (!settings.diagnosticsEnabled || !isHaproxyLanguageId(document.languageId)) {
      return;
    }
    if (document.lineCount > settings.maxDiagnosticsLines) {
      diagnostics.set(document.uri, []);
      return;
    }
    let b: ExtensionBundle;
    try {
      b = await ensureBundle();
    } catch (error) {
      if (document.version !== versionAtStart) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      onBundleError(message);
      diagnostics.set(document.uri, []);
      return;
    }
    if (document.version !== versionAtStart) {
      return;
    }
    diagnostics.set(
      document.uri,
      computeDiagnostics(document, b.schema, {
        languageData: b.languageData,
        deprecatedWarnings: settings.deprecatedWarnings,
        unusedSymbols: settings.unusedSymbols,
        missingReferences: settings.missingReferences,
        maxLines: settings.maxDiagnosticsLines,
      }),
    );
  };

  const cancelPending = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    const existing = pendingDiagnostics.get(key);
    if (existing) {
      clearTimeout(existing);
      pendingDiagnostics.delete(key);
    }
  };

  const schedule = (document: vscode.TextDocument): void => {
    if (!isHaproxyLanguageId(document.languageId)) {
      return;
    }
    const settings = getSettings();
    if (!settings.diagnosticsEnabled) {
      diagnostics.delete(document.uri);
      return;
    }
    cancelPending(document);
    pendingDiagnostics.set(
      document.uri.toString(),
      setTimeout(() => {
        pendingDiagnostics.delete(document.uri.toString());
        void runDiagnostics(document);
      }, settings.diagnosticsDebounceMs),
    );
  };

  const runNow = (document: vscode.TextDocument): void => {
    if (!isHaproxyLanguageId(document.languageId)) {
      return;
    }
    const settings = getSettings();
    if (!settings.diagnosticsEnabled) {
      diagnostics.delete(document.uri);
      return;
    }
    cancelPending(document);
    void runDiagnostics(document);
  };

  const disposeDocument = (document: vscode.TextDocument): void => {
    cancelPending(document);
    diagnostics.delete(document.uri);
  };

  return { schedule, runNow, clearPending, disposeDocument };
}
