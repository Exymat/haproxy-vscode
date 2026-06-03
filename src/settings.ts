import * as vscode from "vscode";

const SECTION = "haproxy";

export interface HaproxyExtensionSettings {
  diagnosticsEnabled: boolean;
  diagnosticsDebounceMs: number;
  maxDiagnosticsLines: number;
}

export function getExtensionSettings(): HaproxyExtensionSettings {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    diagnosticsEnabled: config.get<boolean>("diagnostics.enabled", true),
    diagnosticsDebounceMs: Math.max(100, config.get<number>("diagnostics.debounceMs", 500)),
    maxDiagnosticsLines: Math.max(100, config.get<number>("diagnostics.maxLines", 4000)),
  };
}

export function onSettingsChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SECTION)) {
      listener();
    }
  });
}
