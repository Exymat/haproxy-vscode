import * as vscode from "vscode";

export function workspaceUriKey(uri: vscode.Uri): string {
  const value = uri.toString();
  const isFileUri = uri.scheme === "file" || value.toLowerCase().startsWith("file:");
  if (!isFileUri) {
    return value;
  }
  const fsPath = uri.fsPath ?? "";
  const isWindowsFileUri =
    process.platform === "win32" ||
    /^[a-z]:[\\/]/i.test(fsPath) ||
    /^file:\/\/\/[a-z]%3a/i.test(value);
  return isWindowsFileUri ? value.toLowerCase() : value;
}
