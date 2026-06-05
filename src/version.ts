import * as vscode from "vscode";

export const SUPPORTED_HAPROXY_VERSIONS = ["2.6", "2.8", "3.0", "3.2", "3.4"] as const;
export type HaproxyVersion = (typeof SUPPORTED_HAPROXY_VERSIONS)[number];

export const DEFAULT_HAPROXY_VERSION: HaproxyVersion = "3.2";

const CONFIG_SECTION = "haproxy";
const CONFIG_VERSION = "version";

function isHaproxyVersion(raw: string | undefined): raw is HaproxyVersion {
  return (SUPPORTED_HAPROXY_VERSIONS as readonly string[]).includes(raw ?? "");
}

export function getConfiguredVersion(): HaproxyVersion {
  const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(CONFIG_VERSION);
  if (isHaproxyVersion(raw)) {
    return raw;
  }
  return DEFAULT_HAPROXY_VERSION;
}

export async function setConfiguredVersion(version: HaproxyVersion): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update(CONFIG_VERSION, version, target);
}

export function onVersionConfigurationChanged(
  listener: (version: HaproxyVersion) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_VERSION}`)) {
      listener(getConfiguredVersion());
    }
  });
}
