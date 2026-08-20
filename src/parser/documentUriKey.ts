/** Normalizes document URIs and content fingerprints used as cache keys. */
import * as vscode from "vscode";

import { fingerprintText } from "../core/contentFingerprint";
import { normalizeUriKey } from "../core/uriKey";

export function documentUriKey(document: vscode.TextDocument): string {
  return normalizeUriKey(document.uri);
}

export function documentContentFingerprint(document: vscode.TextDocument): string {
  return fingerprintText(document.getText());
}

/** Cheap invalidation token for open-editor parse caches keyed by URI + version. */
export function documentOpenCacheFingerprint(document: vscode.TextDocument): string {
  return `${document.version}`;
}

export function isOpenTextDocument(document: vscode.TextDocument): boolean {
  const uriKey = documentUriKey(document);
  return vscode.workspace.textDocuments.some((open) => documentUriKey(open) === uriKey);
}

export function documentParseCacheFingerprint(document: vscode.TextDocument): string {
  return isOpenTextDocument(document)
    ? documentOpenCacheFingerprint(document)
    : documentContentFingerprint(document);
}
