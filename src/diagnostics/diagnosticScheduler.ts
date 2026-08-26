/** Debounces and schedules diagnostic computation for open documents. */

import * as vscode from "vscode";

import { computeDiagnostics } from "./index";
import { isHaproxyLanguageId } from "../extension/grammar";
import { ExtensionBundle } from "../extension/extensionBundle";
import { HaproxyExtensionSettings } from "../extension/settings";

export interface DiagnosticScheduler {
  schedule: (document: vscode.TextDocument) => void;
  runNow: (document: vscode.TextDocument) => void;
  clearPending: () => void;
  disposeDocument: (document: vscode.TextDocument) => void;
}

export function createDiagnosticScheduler(
  diagnostics: vscode.DiagnosticCollection,
  getSettings: () => HaproxyExtensionSettings,
  ensureBundle: (document: vscode.TextDocument) => Promise<ExtensionBundle>,
  onBundleError: (message: string) => void,
): DiagnosticScheduler {
  const pendingDiagnostics = new Map<string, NodeJS.Timeout>();
  const generations = new Map<string, number>();
  let generationCounter = 0;

  const nextGeneration = (key: string): number => {
    generationCounter += 1;
    generations.set(key, generationCounter);
    return generationCounter;
  };

  const isCurrentRun = (
    document: vscode.TextDocument,
    versionAtStart: number,
    generation: number,
  ): boolean =>
    document.version === versionAtStart &&
    generations.get(document.uri.toString()) === generation &&
    getSettings().diagnosticsEnabled &&
    isHaproxyLanguageId(document.languageId);

  const clearPending = (): void => {
    for (const timer of pendingDiagnostics.values()) {
      clearTimeout(timer);
    }
    pendingDiagnostics.clear();
    for (const key of generations.keys()) {
      nextGeneration(key);
    }
  };

  const runDiagnostics = async (
    document: vscode.TextDocument,
    generation: number,
  ): Promise<void> => {
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
      b = await ensureBundle(document);
    } catch (error) {
      if (!isCurrentRun(document, versionAtStart, generation)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      onBundleError(message);
      diagnostics.set(document.uri, []);
      return;
    }
    if (!isCurrentRun(document, versionAtStart, generation)) {
      return;
    }
    diagnostics.set(
      document.uri,
      computeDiagnostics(document, b.schema, {
        languageData: b.languageData,
        deprecatedWarnings: settings.deprecatedWarnings,
        unusedSymbols: settings.unusedSymbols,
        missingReferences: settings.missingReferences,
        maxSymbolLines: settings.maxSymbolLines,
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
    const key = document.uri.toString();
    const generation = nextGeneration(key);
    if (!settings.diagnosticsEnabled) {
      cancelPending(document);
      diagnostics.delete(document.uri);
      return;
    }
    cancelPending(document);
    pendingDiagnostics.set(
      key,
      setTimeout(() => {
        pendingDiagnostics.delete(key);
        void runDiagnostics(document, generation);
      }, settings.diagnosticsDebounceMs),
    );
  };

  const runNow = (document: vscode.TextDocument): void => {
    if (!isHaproxyLanguageId(document.languageId)) {
      return;
    }
    const settings = getSettings();
    const generation = nextGeneration(document.uri.toString());
    if (!settings.diagnosticsEnabled) {
      cancelPending(document);
      diagnostics.delete(document.uri);
      return;
    }
    cancelPending(document);
    void runDiagnostics(document, generation);
  };

  const disposeDocument = (document: vscode.TextDocument): void => {
    cancelPending(document);
    generations.delete(document.uri.toString());
    diagnostics.delete(document.uri);
  };

  return { schedule, runNow, clearPending, disposeDocument };
}
