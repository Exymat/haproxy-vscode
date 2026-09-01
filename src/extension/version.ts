/** Resolves supported and configured HAProxy versions from settings and disk. */
import * as fs from "fs";
import * as path from "path";

import * as vscode from "vscode";

export type HaproxyVersion = string;
export type HaproxyEdition = "community" | "hapee";

const CONFIG_SECTION = "haproxy";
const CONFIG_VERSION = "version";
const CONFIG_EDITION = "edition";

export const DEFAULT_HAPROXY_EDITION: HaproxyEdition = "community";
const FALLBACK_HAPEE_SCHEMA_VERSIONS = ["2.6", "2.8", "3.0", "3.2"] as const;
export type HapeeSchemaVersion = string;

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
  const syntaxesDir = path.join(__dirname, "..", "syntaxes");
  try {
    const schemaFiles = new Set(fs.readdirSync(schemasDir));
    const grammarFiles = new Set(fs.readdirSync(syntaxesDir));
    const versions = [...schemaFiles]
      .map((name) => /^haproxy-(\d+\.\d+)\.schema\.json$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1])
      .filter(
        (version) =>
          schemaFiles.has(`haproxy-${version}.language.json`) &&
          grammarFiles.has(`haproxy-${version}.tmLanguage.json`),
      )
      .sort(compareVersions);
    if (versions.length > 0) {
      return versions;
    }
  } catch {
    // Fall back when schemas are unavailable (e.g. isolated unit tests).
  }
  return ["2.6", "2.8", "3.0", "3.2", "3.4"];
}

function discoverHapeeSchemaVersions(): readonly HapeeSchemaVersion[] {
  const schemasDir = path.join(__dirname, "..", "schemas");
  const syntaxesDir = path.join(__dirname, "..", "syntaxes");
  try {
    const schemaFiles = new Set(fs.readdirSync(schemasDir));
    const grammarFiles = new Set(fs.readdirSync(syntaxesDir));
    const versions = [...schemaFiles]
      .map((name) => /^haproxy-(\d+\.\d+)r1\.schema\.json$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1])
      .filter(
        (version) =>
          schemaFiles.has(`haproxy-${version}r1.language.json`) &&
          grammarFiles.has(`haproxy-${version}r1.tmLanguage.json`),
      )
      .sort(compareVersions);
    return versions;
  } catch {
    // Fall back when schemas are unavailable (e.g. isolated unit tests).
    return FALLBACK_HAPEE_SCHEMA_VERSIONS;
  }
}

export const SUPPORTED_HAPROXY_VERSIONS = discoverSupportedVersions();
export const HAPEE_SCHEMA_VERSIONS = discoverHapeeSchemaVersions();

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

function isHaproxyEdition(raw: string | undefined): raw is HaproxyEdition {
  return raw === "community" || raw === "hapee";
}

function readConfiguredEdition(config: vscode.WorkspaceConfiguration): HaproxyEdition {
  const raw = config.get<string>(CONFIG_EDITION);
  if (isHaproxyEdition(raw)) {
    return raw;
  }
  return DEFAULT_HAPROXY_EDITION;
}

export function getConfiguredEdition(): HaproxyEdition {
  return readConfiguredEdition(vscode.workspace.getConfiguration(CONFIG_SECTION));
}

export function getConfiguredEditionForUri(resource?: vscode.Uri): HaproxyEdition {
  return readConfiguredEdition(vscode.workspace.getConfiguration(CONFIG_SECTION, resource));
}

function configurationTarget(resource?: vscode.Uri): vscode.ConfigurationTarget {
  const folder = resource ? vscode.workspace.getWorkspaceFolder(resource) : undefined;
  if (folder) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  return vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

export async function setConfiguredVersion(
  version: HaproxyVersion,
  resource?: vscode.Uri,
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
  await config.update(CONFIG_VERSION, version, configurationTarget(resource));
}

export async function setConfiguredEdition(
  edition: HaproxyEdition,
  resource?: vscode.Uri,
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
  await config.update(CONFIG_EDITION, edition, configurationTarget(resource));
}

export async function setConfiguredProfile(
  version: HaproxyVersion,
  edition: HaproxyEdition,
  resource?: vscode.Uri,
): Promise<void> {
  await Promise.all([
    setConfiguredVersion(version, resource),
    setConfiguredEdition(edition, resource),
  ]);
}

export function hapeeSchemaAvailable(version: string): boolean {
  return HAPEE_SCHEMA_VERSIONS.includes(version);
}

export function schemaArtifactId(
  version: HaproxyVersion,
  edition: HaproxyEdition = DEFAULT_HAPROXY_EDITION,
): string {
  if (edition === "hapee" && hapeeSchemaAvailable(version)) {
    return `${version}r1`;
  }
  return version;
}

export function effectiveEditionForVersion(
  version: HaproxyVersion,
  edition: HaproxyEdition,
): HaproxyEdition {
  if (edition === "hapee" && hapeeSchemaAvailable(version)) {
    return "hapee";
  }
  return "community";
}

export function bundleCacheKey(
  version: HaproxyVersion,
  edition: HaproxyEdition = DEFAULT_HAPROXY_EDITION,
): string {
  return `${version}::${effectiveEditionForVersion(version, edition)}`;
}

export interface VersionConfigurationChange {
  versions: HaproxyVersion[];
  affectedFolderUris: (string | undefined)[];
}

function collectVersionConfigurationChange(
  event: vscode.ConfigurationChangeEvent,
): VersionConfigurationChange | undefined {
  const versionSection = `${CONFIG_SECTION}.${CONFIG_VERSION}`;
  const editionSection = `${CONFIG_SECTION}.${CONFIG_EDITION}`;
  if (!event.affectsConfiguration(versionSection) && !event.affectsConfiguration(editionSection)) {
    return undefined;
  }

  const versions = new Set<HaproxyVersion>();
  const affectedFolderUris: (string | undefined)[] = [];
  const seenFolderUris = new Set<string | undefined>();

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (
      event.affectsConfiguration(versionSection, folder.uri) ||
      event.affectsConfiguration(editionSection, folder.uri)
    ) {
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
  let pendingVersions = new Set<HaproxyVersion>();
  let pendingFolderUris = new Set<string | undefined>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
    const change = collectVersionConfigurationChange(event);
    if (change) {
      change.versions.forEach((version) => pendingVersions.add(version));
      change.affectedFolderUris.forEach((uri) => pendingFolderUris.add(uri));
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        const merged = {
          versions: [...pendingVersions],
          affectedFolderUris: [...pendingFolderUris],
        };
        pendingVersions = new Set();
        pendingFolderUris = new Set();
        listener(merged);
      }, 0);
    }
  });
  return {
    dispose: () => {
      if (timer) {
        clearTimeout(timer);
      }
      subscription.dispose();
    },
  };
}
