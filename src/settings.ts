import * as vscode from "vscode";

import { FormatOptions } from "./formatter";
import {
  FormatIndent,
  formatIndentToOptions,
  isFormatIndent,
  legacyFormatIndent,
} from "./formatIndent";

const SECTION = "haproxy";

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
    diagnosticsDebounceMs: Math.max(100, config.get<number>("diagnostics.debounceMs", 500)),
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
