import * as fs from "fs";
import * as path from "path";

import * as vscode from "vscode";

export type HaproxyVersion = string;

const CONFIG_SECTION = "haproxy";
const CONFIG_VERSION = "version";

function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor = "0"] = a.split(".");
  const [bMajor, bMinor = "0"] = b.split(".");
  const majorDiff = Number(aMajor) - Number(bMajor);
  if (majorDiff !== 0) {
    return majorDiff;
  }
  return Number(aMinor) - Number(bMinor);
}

function discoverSupportedVersions(): readonly HaproxyVersion[] {
  const schemasDir = path.join(__dirname, "..", "schemas");
  try {
    const versions = fs
      .readdirSync(schemasDir)
      .map((name) => /^haproxy-(\d+\.\d+)\.schema\.json$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1])
      .sort(compareVersions);
    if (versions.length > 0) {
      return versions;
    }
  } catch {
    // Fall back when schemas are unavailable (e.g. isolated unit tests).
  }
  return ["2.6", "2.8", "3.0", "3.2", "3.4"];
}

export const SUPPORTED_HAPROXY_VERSIONS = discoverSupportedVersions();

export const DEFAULT_HAPROXY_VERSION: HaproxyVersion =
  (SUPPORTED_HAPROXY_VERSIONS.includes("3.2")
    ? "3.2"
    : SUPPORTED_HAPROXY_VERSIONS[SUPPORTED_HAPROXY_VERSIONS.length - 1]) ?? "3.2";

function isHaproxyVersion(raw: string | undefined): raw is HaproxyVersion {
  return SUPPORTED_HAPROXY_VERSIONS.includes(raw ?? "");
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
