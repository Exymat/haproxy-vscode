import * as vscode from "vscode";

export const SUPPORTED_HAPROXY_VERSIONS = ["2.6", "2.8", "3.0", "3.2", "3.4"] as const;
export type HaproxyVersion = (typeof SUPPORTED_HAPROXY_VERSIONS)[number];

export const DEFAULT_HAPROXY_VERSION: HaproxyVersion = "3.2";

const CONFIG_SECTION = "haproxy";
const CONFIG_VERSION = "version";

function isHaproxyVersion(raw: string | undefined): raw is HaproxyVersion {
  return (SUPPORTED_HAPROXY_VERSIONS as readonly string[]).includes(raw ?? "");
}

function readConfiguredVersion(config: vscode.WorkspaceConfiguration): HaproxyVersion {
  const raw = config.get<string>(CONFIG_VERSION);
  if (isHaproxyVersion(raw)) {
    return raw;
  }
  return DEFAULT_HAPROXY_VERSION;
}

export function getConfiguredVersion(): HaproxyVersion {
  return readConfiguredVersion(vscode.workspace.getConfiguration(CONFIG_SECTION));
}

export function getConfiguredVersionForUri(resource?: vscode.Uri): HaproxyVersion {
  return readConfiguredVersion(vscode.workspace.getConfiguration(CONFIG_SECTION, resource));
}

export async function setConfiguredVersion(
  version: HaproxyVersion,
  resource?: vscode.Uri,
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
  const folder = resource ? vscode.workspace.getWorkspaceFolder(resource) : undefined;
  const target = folder
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update(CONFIG_VERSION, version, target);
}

export interface VersionConfigurationChange {
  versions: HaproxyVersion[];
  affectedFolderUris: (string | undefined)[];
}

function collectVersionConfigurationChange(
  event: vscode.ConfigurationChangeEvent,
): VersionConfigurationChange | undefined {
  const section = `${CONFIG_SECTION}.${CONFIG_VERSION}`;
  if (!event.affectsConfiguration(section)) {
    return undefined;
  }

  const versions = new Set<HaproxyVersion>();
  const affectedFolderUris: (string | undefined)[] = [];
  const seenFolderUris = new Set<string | undefined>();

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (event.affectsConfiguration(section, folder.uri)) {
      const folderUri = folder.uri.toString();
      if (!seenFolderUris.has(folderUri)) {
        seenFolderUris.add(folderUri);
        affectedFolderUris.push(folderUri);
      }
      versions.add(getConfiguredVersionForUri(folder.uri));
    }
  }

  if (affectedFolderUris.length === 0) {
    affectedFolderUris.push(undefined);
    versions.add(getConfiguredVersion());
  }

  return { versions: [...versions], affectedFolderUris };
}

export function onVersionConfigurationChanged(
  listener: (change: VersionConfigurationChange) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    const change = collectVersionConfigurationChange(event);
    if (change) {
      listener(change);
    }
  });
}
