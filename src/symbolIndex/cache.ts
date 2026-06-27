import * as vscode from "vscode";

import { getParsedDocument } from "../parseCache";
import { HaproxySchema } from "../schema";

import { buildSymbolIndex } from "./build";
import { SymbolIndex } from "./types";

const indexCache = new WeakMap<vscode.TextDocument, { version: number; index: SymbolIndex }>();

export function getSymbolIndex(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
): SymbolIndex | null {
  if (document.lineCount > maxLines) {
    return null;
  }

  const hit = indexCache.get(document);
  if (hit && hit.version === document.version) {
    return hit.index;
  }

  const parsed = getParsedDocument(document);
  const index = buildSymbolIndex(parsed, schema);
  indexCache.set(document, { version: document.version, index });
  return index;
}
