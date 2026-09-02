/** Shared URI normalization for document and workspace cache keys. */
import * as vscode from "vscode";

function isWindowsFileUri(uri: vscode.Uri, value: string): boolean {
  if (process.platform === "win32") {
    return true;
  }
  const fsPath = uri.fsPath ?? "";
  // Drive-letter fsPath (C:\... or C:/...) or Windows file URI forms:
  // file://C:/..., file:///C:/..., file:///c%3a/...
  return (
    /^[a-z]:[\\/]/i.test(fsPath) ||
    /^file:\/\/\/?[a-z]:/i.test(value) ||
    /^file:\/\/\/[a-z]%3a/i.test(value)
  );
}

export function normalizeUriKey(uri: vscode.Uri): string {
  const value = uri.toString();
  const isFileUri = uri.scheme === "file" || value.toLowerCase().startsWith("file:");
  if (!isFileUri) {
    return value;
  }
  return isWindowsFileUri(uri, value) ? value.toLowerCase() : value;
}

export function documentUriKey(document: vscode.TextDocument): string {
  return normalizeUriKey(document.uri);
}

export function workspaceUriKey(uri: vscode.Uri): string {
  return normalizeUriKey(uri);
}
