import * as vscode from "vscode";

import {
  GLOBAL_WORKSPACE_FOLDER_KEY,
  workspaceFolderForUri,
  workspaceFolderKey,
} from "../symbolIndex/workspaceDiscovery";
import { WorkspaceRebuildScope, WorkspaceSymbolSettings } from "../symbolIndex/workspaceTypes";
import {
  getConfiguredVersion,
  getConfiguredVersionForUri,
  HaproxyVersion,
  SUPPORTED_HAPROXY_VERSIONS,
} from "./version";
import { workspaceUriKey } from "../symbolIndex/workspaceUri";

export interface HaproxyLogSink {
  appendLine(value: string): void;
}

export type WorkspaceEntrySkipReason =
  | "unsupported-language"
  | "too-many-lines"
  | "file-too-large"
  | "line-too-long"
  | "not-haproxy-config"
  | "read-failed";

export interface WorkspaceIndexBuildStats {
  folderKey: string;
  folderLabel: string;
  scope: WorkspaceRebuildScope;
  discoveredFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  skipReasons: Partial<Record<WorkspaceEntrySkipReason, number>>;
  capped: boolean;
  capReason?: string;
  totalLines: number;
  totalBytes: number;
  durationMs: number;
}

let logSink: HaproxyLogSink | undefined;
const loggedVersionsByFolder = new Map<string, HaproxyVersion>();

function timestamp(): string {
  return new Date().toISOString();
}

function writeln(message: string): void {
  logSink?.appendLine(`[${timestamp()}] ${message}`);
}

function folderContext(uri?: vscode.Uri): { folderKey: string; folderLabel: string } {
  const folder = uri ? workspaceFolderForUri(uri) : undefined;
  const folderKey = workspaceFolderKey(folder);
  const folderLabel =
    folder?.name ??
    folder?.uri.fsPath ??
    (folderKey === GLOBAL_WORKSPACE_FOLDER_KEY ? "global" : folderKey);
  return { folderKey, folderLabel };
}

function formatSkipReasons(skipReasons: Partial<Record<WorkspaceEntrySkipReason, number>>): string {
  const parts = Object.entries(skipReasons)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([reason, count]) => `${reason}=${count}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function formatWorkspaceLimits(
  settings: Pick<
    WorkspaceSymbolSettings,
    "maxFiles" | "maxTotalLines" | "maxFileBytes" | "maxTotalBytes" | "maxLineBytes"
  >,
): string {
  return [
    `maxFiles=${settings.maxFiles}`,
    `maxTotalLines=${settings.maxTotalLines}`,
    `maxFileBytes=${settings.maxFileBytes}`,
    `maxTotalBytes=${settings.maxTotalBytes}`,
    `maxLineBytes=${settings.maxLineBytes}`,
  ].join(", ");
}

export function registerHaproxyOutputChannel(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("HAProxy");
  logSink = channel;
  context.subscriptions.push(channel);
}

export function setHaproxyLogSink(sink: HaproxyLogSink | undefined): void {
  logSink = sink;
}

export function resetHaproxyOutputChannelState(): void {
  loggedVersionsByFolder.clear();
}

export function logExtensionActivated(extensionVersion: string): void {
  writeln(`Extension activated (v${extensionVersion})`);
  writeln(`Supported HAProxy versions: ${SUPPORTED_HAPROXY_VERSIONS.join(", ")}`);
}

export function logConfiguredVersion(
  version: HaproxyVersion,
  reason: "config-change" | "document-open",
  resource?: vscode.Uri,
): void {
  const { folderKey, folderLabel } = folderContext(resource);
  if (reason === "document-open" && loggedVersionsByFolder.get(folderKey) === version) {
    return;
  }
  loggedVersionsByFolder.set(folderKey, version);
  const reasonLabel = reason === "config-change" ? "configuration changed" : "document opened";
  writeln(`HAProxy version ${version} for ${folderLabel} (${reasonLabel})`);
}

export function logBundleLoadStarted(version: HaproxyVersion): void {
  writeln(`Loading schema and language data for HAProxy ${version}...`);
}

export function logBundleLoadSucceeded(version: HaproxyVersion): void {
  writeln(`Loaded schema and language data for HAProxy ${version}`);
}

export function logBundleLoadFailed(
  version: HaproxyVersion,
  message: string,
  component?: "schema" | "language-data",
): void {
  const componentLabel = component ? ` (${component})` : "";
  writeln(`Failed to load schema bundle for HAProxy ${version}${componentLabel}: ${message}`);
}

export function logWorkspaceIndexStarted(
  folderKey: string,
  folderLabel: string,
  scope: WorkspaceRebuildScope,
  settings: Pick<
    WorkspaceSymbolSettings,
    "maxFiles" | "maxTotalLines" | "maxFileBytes" | "maxTotalBytes" | "maxLineBytes"
  >,
): void {
  if (scope === "incremental" || scope === "none") {
    return;
  }
  writeln(
    `Workspace index rebuild started (${scope}) for ${folderLabel} [${formatWorkspaceLimits(settings)}]`,
  );
}

export function logWorkspaceIndexCompleted(stats: WorkspaceIndexBuildStats): void {
  if (stats.scope === "incremental" || stats.scope === "none") {
    return;
  }
  const capSuffix = stats.capped ? `; CAPPED${stats.capReason ? ` (${stats.capReason})` : ""}` : "";
  writeln(
    `Workspace index rebuild finished for ${stats.folderLabel} in ${stats.durationMs}ms: ` +
      `discovered=${stats.discoveredFiles}, indexed=${stats.indexedFiles}, ` +
      `skipped=${stats.skippedFiles}, lines=${stats.totalLines}, bytes=${stats.totalBytes}` +
      `${capSuffix}`,
  );
  const skipSummary = formatSkipReasons(stats.skipReasons);
  if (stats.skippedFiles > 0 || stats.capped) {
    writeln(`  skip reasons: ${skipSummary}`);
  }
}

export function logWorkspaceIndexSchemaLoadFailed(
  folderLabel: string,
  scope: WorkspaceRebuildScope,
  error: unknown,
): void {
  if (scope === "incremental" || scope === "none") {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  writeln(
    `Workspace index schema resolution failed (${scope}) for ${folderLabel}; ` +
      `skipping folder: ${message}`,
  );
}

export function logWorkspaceIndexDisabled(): void {
  writeln("Workspace symbol index disabled");
}

export function logSupportSnapshot(params: {
  extensionVersion: string;
  bundleVersion: HaproxyVersion;
  workspaceSymbolSettings: WorkspaceSymbolSettings;
}): void {
  writeln("--- support snapshot ---");
  writeln(`extension: v${params.extensionVersion}`);
  writeln(`active schema bundle: HAProxy ${params.bundleVersion}`);
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    writeln(`configured HAProxy version (global): ${getConfiguredVersion()}`);
  } else {
    for (const folder of folders) {
      const version = getConfiguredVersionForUri(folder.uri);
      writeln(`configured HAProxy version (${folder.name}): ${version}`);
    }
  }
  const settings = params.workspaceSymbolSettings;
  writeln(
    `workspace symbols: ${settings.enabled ? "enabled" : "disabled"}, ` +
      `include=[${settings.include.join(", ")}], exclude=[${settings.exclude.join(", ")}], ` +
      formatWorkspaceLimits(settings),
  );
  writeln("--- end support snapshot ---");
}

export function logDiskEntryReadFailure(uri: vscode.Uri, code: string): void {
  writeln(`Skipped unreadable file (${code}): ${workspaceUriKey(uri)}`);
}
