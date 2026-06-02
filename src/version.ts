import * as vscode from "vscode";

export const SUPPORTED_HAPROXY_VERSIONS = ["3.0", "3.2"] as const;
export type HaproxyVersion = (typeof SUPPORTED_HAPROXY_VERSIONS)[number];

export const DEFAULT_HAPROXY_VERSION: HaproxyVersion = "3.2";

const CONFIG_SECTION = "haproxy";
const CONFIG_VERSION = "version";

export function getConfiguredVersion(): HaproxyVersion {
  const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(CONFIG_VERSION);
  if (raw === "3.0" || raw === "3.2") {
    return raw;
  }
  return DEFAULT_HAPROXY_VERSION;
}

export function onVersionConfigurationChanged(
  listener: (version: HaproxyVersion) => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_VERSION}`)) {
      listener(getConfiguredVersion());
    }
  });
}
