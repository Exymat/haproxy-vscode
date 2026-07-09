import * as vscode from "vscode";

import { isHaproxyLanguageId } from "./grammar";

export function refreshDocumentsInFolders(
  folderUris: readonly (string | undefined)[],
  documents: readonly vscode.TextDocument[],
  schedule: (document: vscode.TextDocument) => void,
  getWorkspaceFolder: (uri: vscode.Uri) => vscode.WorkspaceFolder | undefined = vscode.workspace
    .getWorkspaceFolder,
): void {
  const refreshAll = folderUris.some((folderUri) => folderUri === undefined);
  if (refreshAll) {
    for (const document of documents) {
      schedule(document);
    }
    return;
  }
  const folderUriSet = new Set(folderUris);
  for (const document of documents) {
    if (!isHaproxyLanguageId(document.languageId)) {
      continue;
    }
    const folder = getWorkspaceFolder(document.uri);
    const folderUri = folder?.uri.toString();
    if (folderUri && folderUriSet.has(folderUri)) {
      schedule(document);
    }
  }
}
