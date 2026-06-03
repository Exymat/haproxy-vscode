import * as vscode from "vscode";

import {
  getConfiguredVersion,
  HaproxyVersion,
  onVersionConfigurationChanged,
  setConfiguredVersion,
  SUPPORTED_HAPROXY_VERSIONS,
} from "./version";

const SELECT_VERSION_COMMAND = "haproxy.selectVersion";

function isHaproxyEditor(editor: vscode.TextEditor | undefined): boolean {
  return editor?.document.languageId === "haproxy";
}

export function registerVersionStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = SELECT_VERSION_COMMAND;
  context.subscriptions.push(item);

  const refresh = (): void => {
    const version = getConfiguredVersion();
    item.text = `$(versions) HAProxy ${version}`;
    item.tooltip = "Click to change HAProxy version used for completion, diagnostics, and highlighting";
    if (isHaproxyEditor(vscode.window.activeTextEditor)) {
      item.show();
    } else {
      item.hide();
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    onVersionConfigurationChanged(() => refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(SELECT_VERSION_COMMAND, async () => {
      const current = getConfiguredVersion();
      const picked = await vscode.window.showQuickPick(
        [...SUPPORTED_HAPROXY_VERSIONS].map((version) => ({
          label: version,
          picked: version === current,
        })),
        {
          title: "HAProxy version",
          placeHolder: "Select HAProxy release for completion, diagnostics, and highlighting",
        }
      );
      if (picked && picked.label !== current) {
        await setConfiguredVersion(picked.label as HaproxyVersion);
      }
    })
  );

  refresh();
}
