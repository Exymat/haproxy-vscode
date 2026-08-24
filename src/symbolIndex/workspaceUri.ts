/** Normalizes workspace URIs for stable cache and map keys. */
import * as vscode from "vscode";

import { normalizeUriKey } from "../core/uriKey";

export function workspaceUriKey(uri: vscode.Uri): string {
  return normalizeUriKey(uri);
}
