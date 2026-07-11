import * as vscode from "vscode";

import { isHaproxyLanguageId } from "./grammar";
import { isDocumentWorkspaceIndexCapped } from "../symbolIndex/workspace";

export const OPEN_WORKSPACE_SYMBOL_SETTINGS_COMMAND = "haproxy.openWorkspaceSymbolSettings";

function isHaproxyEditor(editor: vscode.TextEditor | undefined): boolean {
  return editor !== undefined && isHaproxyLanguageId(editor.document.languageId);
}

export function registerWorkspaceIndexStatusBar(context: vscode.ExtensionContext): () => void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  item.text = "$(warning) HAProxy index capped";
  item.tooltip =
    "Workspace symbol limits were exceeded; cross-file navigation and related features are disabled for this folder. Click to open settings.";
  item.command = OPEN_WORKSPACE_SYMBOL_SETTINGS_COMMAND;
  context.subscriptions.push(item);

  const refresh = (): void => {
    const editor = vscode.window.activeTextEditor;
    if (editor && isHaproxyEditor(editor) && isDocumentWorkspaceIndexCapped(editor.document)) {
      item.show();
    } else {
      item.hide();
    }
  };

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => refresh()));

  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_WORKSPACE_SYMBOL_SETTINGS_COMMAND, () => {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@id:haproxy.workspaceSymbols.maxFiles",
      );
    }),
  );

  refresh();
  return refresh;
}
