/** Status bar warning when per-document symbol indexing hits the line limit. */
import * as vscode from "vscode";

import { isHaproxyLanguageId } from "./grammar";
import { HaproxyExtensionSettings } from "./settings";

export const OPEN_SYMBOL_LINES_SETTINGS_COMMAND = "haproxy.openSymbolLinesSettings";

function isHaproxyEditor(editor: vscode.TextEditor | undefined): boolean {
  return editor !== undefined && isHaproxyLanguageId(editor.document.languageId);
}

export function isDocumentSymbolLinesCapped(
  document: vscode.TextDocument,
  maxSymbolLines: number,
): boolean {
  return isHaproxyLanguageId(document.languageId) && document.lineCount > maxSymbolLines;
}

export function registerSymbolLinesStatusBar(
  context: vscode.ExtensionContext,
  getSettings: () => HaproxyExtensionSettings,
): () => void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  item.text = "$(warning) HAProxy symbols capped";
  item.tooltip =
    "This file exceeds the symbol index line limit; navigation, rename, and symbol-based completions are disabled. Click to open settings.";
  item.command = OPEN_SYMBOL_LINES_SETTINGS_COMMAND;
  context.subscriptions.push(item);

  const refresh = (): void => {
    const editor = vscode.window.activeTextEditor;
    const maxSymbolLines = getSettings().maxSymbolLines;
    if (
      editor &&
      isHaproxyEditor(editor) &&
      isDocumentSymbolLinesCapped(editor.document, maxSymbolLines)
    ) {
      item.show();
    } else {
      item.hide();
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    vscode.workspace.onDidOpenTextDocument(() => refresh()),
    vscode.workspace.onDidChangeTextDocument(() => refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("haproxy.symbols.maxLines")) {
        refresh();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_SYMBOL_LINES_SETTINGS_COMMAND, () => {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@id:haproxy.symbols.maxLines",
      );
    }),
  );

  refresh();
  return refresh;
}
