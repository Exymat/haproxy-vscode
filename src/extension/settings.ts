import * as vscode from "vscode";

import { FormatOptions } from "../formatting";
import {
  FormatIndent,
  formatIndentToOptions,
  isFormatIndent,
  legacyFormatIndent,
} from "../formatting/formatIndent";

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

function workspaceSymbolLimit(
  config: vscode.WorkspaceConfiguration,
  key: string,
  minimum: number,
): number {
  const value = config.get<number>(key, 0);
  if (!Number.isFinite(value) || value <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(minimum, value);
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
    workspaceSymbolsMaxFiles: workspaceSymbolLimit(config, "workspaceSymbols.maxFiles", 1),
    workspaceSymbolsMaxTotalLines: workspaceSymbolLimit(
      config,
      "workspaceSymbols.maxTotalLines",
      100,
    ),
    workspaceSymbolsMaxFileBytes: workspaceSymbolLimit(
      config,
      "workspaceSymbols.maxFileBytes",
      10240,
    ),
    workspaceSymbolsMaxTotalBytes: workspaceSymbolLimit(
      config,
      "workspaceSymbols.maxTotalBytes",
      102400,
    ),
    workspaceSymbolsMaxLineBytes: workspaceSymbolLimit(
      config,
      "workspaceSymbols.maxLineBytes",
      256,
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
): Omit<FormatOptions, "sectionHeaders"> {
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
