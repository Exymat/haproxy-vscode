import * as vscode from "vscode";

import { FormatOptions } from "./formatter";
import {
  FormatIndent,
  formatIndentToOptions,
  isFormatIndent,
  legacyFormatIndent,
} from "./formatIndent";

const SECTION = "haproxy";

/** Mirrors `package.json` `haproxy.diagnostics.debounceMs` minimum/maximum. */
const DIAGNOSTICS_DEBOUNCE_MS_MIN = 100;
const DIAGNOSTICS_DEBOUNCE_MS_MAX = 5000;

/** Mirrors `package.json` `haproxy.workspaceSymbols.debounceMs` minimum/maximum. */
const WORKSPACE_SYMBOLS_DEBOUNCE_MS_MIN = 100;
const WORKSPACE_SYMBOLS_DEBOUNCE_MS_MAX = 10000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface HaproxyExtensionSettings {
  diagnosticsEnabled: boolean;
  diagnosticsDebounceMs: number;
  maxDiagnosticsLines: number;
  formatEnabled: boolean;
  formatIndent: FormatIndent;
  formatInsertBlankLineBetweenSections: boolean;
  deprecatedWarnings: boolean;
  unusedSymbols: boolean;
  missingReferences: boolean;
  workspaceSymbolsEnabled: boolean;
  workspaceSymbolsInclude: string[];
  workspaceSymbolsExclude: string[];
  workspaceSymbolsMaxFiles: number;
  workspaceSymbolsMaxTotalLines: number;
  workspaceSymbolsMaxFileBytes: number;
  workspaceSymbolsMaxTotalBytes: number;
  workspaceSymbolsMaxLineBytes: number;
  workspaceSymbolsDebounceMs: number;
}

function readFormatIndent(config: vscode.WorkspaceConfiguration): FormatIndent {
  const indent = config.get<string>("format.indent");
  if (indent && isFormatIndent(indent)) {
    return indent;
  }
  return legacyFormatIndent(
    config.get<string>("format.indentStyle", "spaces"),
    config.get<number>("format.indentSize", 4),
  );
}

export function getExtensionSettings(): HaproxyExtensionSettings {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    diagnosticsEnabled: config.get<boolean>("diagnostics.enabled", true),
    diagnosticsDebounceMs: clamp(
      config.get<number>("diagnostics.debounceMs", 500),
      DIAGNOSTICS_DEBOUNCE_MS_MIN,
      DIAGNOSTICS_DEBOUNCE_MS_MAX,
    ),
    maxDiagnosticsLines: Math.max(100, config.get<number>("diagnostics.maxLines", 4000)),
    formatEnabled: config.get<boolean>("format.enabled", true),
    formatIndent: readFormatIndent(config),
    formatInsertBlankLineBetweenSections: config.get<boolean>(
      "format.insertBlankLineBetweenSections",
      true,
    ),
    deprecatedWarnings: config.get<boolean>("diagnostics.deprecatedWarnings", true),
    unusedSymbols: config.get<boolean>("diagnostics.unusedSymbols", true),
    missingReferences: config.get<boolean>("diagnostics.missingReferences", true),
    workspaceSymbolsEnabled: config.get<boolean>("workspaceSymbols.enabled", true),
    workspaceSymbolsInclude: config.get<string[]>("workspaceSymbols.include", ["**/*.cfg"]),
    workspaceSymbolsExclude: config.get<string[]>("workspaceSymbols.exclude", [
      "**/.git/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/vendor/**",
    ]),
    workspaceSymbolsMaxFiles: Math.max(1, config.get<number>("workspaceSymbols.maxFiles", 1000)),
    workspaceSymbolsMaxTotalLines: Math.max(
      100,
      config.get<number>("workspaceSymbols.maxTotalLines", 100000),
    ),
    workspaceSymbolsMaxFileBytes: Math.max(
      10240,
      config.get<number>("workspaceSymbols.maxFileBytes", 1_000_000),
    ),
    workspaceSymbolsMaxTotalBytes: Math.max(
      102400,
      config.get<number>("workspaceSymbols.maxTotalBytes", 20_000_000),
    ),
    workspaceSymbolsMaxLineBytes: Math.max(
      256,
      config.get<number>("workspaceSymbols.maxLineBytes", 8192),
    ),
    workspaceSymbolsDebounceMs: clamp(
      config.get<number>("workspaceSymbols.debounceMs", 750),
      WORKSPACE_SYMBOLS_DEBOUNCE_MS_MIN,
      WORKSPACE_SYMBOLS_DEBOUNCE_MS_MAX,
    ),
  };
}

export function getFormatOptions(
  settings: HaproxyExtensionSettings = getExtensionSettings(),
): FormatOptions {
  return {
    ...formatIndentToOptions(settings.formatIndent),
    insertBlankLineBetweenSections: settings.formatInsertBlankLineBetweenSections,
  };
}

export function onSettingsChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SECTION)) {
      listener();
    }
  });
}
