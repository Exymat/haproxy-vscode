import * as vscode from "vscode";

import { parseDocument, ParsedLine } from "./parser";

const cache = new WeakMap<vscode.TextDocument, { version: number; parsed: ParsedLine[] }>();

export function getParsedDocument(document: vscode.TextDocument): ParsedLine[] {
  const hit = cache.get(document);
  if (hit && hit.version === document.version) {
    return hit.parsed;
  }
  const parsed = parseDocument(document);
  cache.set(document, { version: document.version, parsed });
  return parsed;
}
