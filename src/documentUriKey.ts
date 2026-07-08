import * as vscode from "vscode";

import { fingerprintText } from "./contentFingerprint";

export function documentUriKey(document: vscode.TextDocument): string {
  const value = document.uri.toString();
  const isFileUri = document.uri.scheme === "file" || value.toLowerCase().startsWith("file:");
  if (!isFileUri) {
    return value;
  }
  const fsPath = document.uri.fsPath ?? "";
  const isWindowsFileUri =
    process.platform === "win32" ||
    /^[a-z]:[\\/]/i.test(fsPath) ||
    /^file:\/\/\/[a-z]%3a/i.test(value);
  return isWindowsFileUri ? value.toLowerCase() : value;
}

export function documentContentFingerprint(document: vscode.TextDocument): string {
  return fingerprintText(document.getText());
}
