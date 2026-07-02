import * as vscode from "vscode";

import { computeDiagnostics } from "./diagnostics";
import { ExtensionBundle } from "./extensionBundle";
import { HaproxyExtensionSettings } from "./settings";

export interface DiagnosticScheduler {
  schedule: (document: vscode.TextDocument) => void;
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
    const settings = getSettings();
    if (!settings.diagnosticsEnabled || document.languageId !== "haproxy") {
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
      const message = error instanceof Error ? error.message : String(error);
      onBundleError(message);
      diagnostics.set(document.uri, []);
      return;
    }
    diagnostics.set(
      document.uri,
      computeDiagnostics(document, b.schema, {
        languageData: b.languageData,
        deprecatedWarnings: settings.deprecatedWarnings,
        unusedSymbols: settings.unusedSymbols,
        maxLines: settings.maxDiagnosticsLines,
      }),
    );
  };

  const schedule = (document: vscode.TextDocument): void => {
    if (document.languageId !== "haproxy") {
      return;
    }
    const settings = getSettings();
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

  const disposeDocument = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    const pending = pendingDiagnostics.get(key);
    if (pending) {
      clearTimeout(pending);
      pendingDiagnostics.delete(key);
    }
    diagnostics.delete(document.uri);
  };

  return { schedule, clearPending, disposeDocument };
}
