/** Status bar UI for selecting and displaying the configured HAProxy version. */
import * as vscode from "vscode";

import { isHaproxyLanguageId } from "./grammar";
import {
  getConfiguredEditionForUri,
  getConfiguredVersionForUri,
  HaproxyEdition,
  hapeeSchemaAvailable,
  HaproxyVersion,
  onVersionConfigurationChanged,
  setConfiguredProfile,
  SUPPORTED_HAPROXY_VERSIONS,
} from "./version";

const SELECT_VERSION_COMMAND = "haproxy.selectVersion";

interface VersionPickItem extends vscode.QuickPickItem {
  version: HaproxyVersion;
  edition: HaproxyEdition;
}

function isHaproxyEditor(editor: vscode.TextEditor | undefined): boolean {
  return editor !== undefined && isHaproxyLanguageId(editor.document.languageId);
}

function statusBarText(version: HaproxyVersion, edition: HaproxyEdition): string {
  if (edition === "hapee" && hapeeSchemaAvailable(version)) {
    return `$(versions) HAProxy ${version} HAPEE`;
  }
  return `$(versions) HAProxy ${version}`;
}

function versionPickItems(): VersionPickItem[] {
  const community = [...SUPPORTED_HAPROXY_VERSIONS].map((version) => ({
    label: version,
    description: "Community",
    version,
    edition: "community" as const,
  }));
  const hapee = [...SUPPORTED_HAPROXY_VERSIONS]
    .filter((version) => hapeeSchemaAvailable(version))
    .map((version) => ({
      label: `${version} HAPEE`,
      description: "HAProxy Enterprise",
      version,
      edition: "hapee" as const,
    }));
  return [...community, ...hapee];
}

export function registerVersionStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = SELECT_VERSION_COMMAND;
  context.subscriptions.push(item);

  const refresh = (): void => {
    const editor = vscode.window.activeTextEditor;
    const version = getConfiguredVersionForUri(editor?.document.uri);
    const edition = getConfiguredEditionForUri(editor?.document.uri);
    item.text = statusBarText(version, edition);
    item.tooltip =
      "Click to change the version and edition for completion, diagnostics, and highlighting";
    if (isHaproxyEditor(vscode.window.activeTextEditor)) {
      item.show();
    } else {
      item.hide();
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    onVersionConfigurationChanged(() => refresh()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(SELECT_VERSION_COMMAND, async () => {
      const editor = vscode.window.activeTextEditor;
      const currentVersion = getConfiguredVersionForUri(editor?.document.uri);
      const currentEdition = getConfiguredEditionForUri(editor?.document.uri);
      const picked = await vscode.window.showQuickPick(versionPickItems(), {
        title: "HAProxy version and edition",
        placeHolder: "Select the HAProxy release and edition",
      });
      if (!picked) {
        return;
      }
      if (picked.version === currentVersion && picked.edition === currentEdition) {
        return;
      }
      await setConfiguredProfile(picked.version, picked.edition, editor?.document.uri);
    }),
  );

  refresh();
}
