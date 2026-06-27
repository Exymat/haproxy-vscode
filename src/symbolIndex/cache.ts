import * as vscode from "vscode";

import { getParsedDocumentEntry, ParsedDocumentEntry } from "../parseCache";
import { isTopLevelSectionHeader } from "../sectionUtils";
import { HaproxySchema } from "../schema";

import {
  buildLineFingerprints,
  buildSymbolIndex,
  collectLineSymbolSites,
  symbolSiteFingerprint,
} from "./build";
import { SymbolIndex } from "./types";

interface IndexCacheEntry {
  version: number;
  index: SymbolIndex;
  lineFingerprints: string[];
}

const indexCache = new WeakMap<vscode.TextDocument, IndexCacheEntry>();

function dirtyLineCount(entry: ParsedDocumentEntry): number {
  const { reuse, parsed } = entry;
  return parsed.length - reuse.prefixLines - reuse.suffixLines;
}

function canReuseSymbolIndex(
  cached: IndexCacheEntry,
  parseEntry: ParsedDocumentEntry,
  schema: HaproxySchema,
): boolean {
  const { reuse, parsed } = parseEntry;
  if (reuse.previousVersion === null) {
    return false;
  }
  if (parsed.length !== cached.lineFingerprints.length) {
    return false;
  }
  if (dirtyLineCount(parseEntry) !== 1) {
    return false;
  }

  const dirtyLineNo = reuse.prefixLines;
  const line = parsed[dirtyLineNo];
  if (!line || isTopLevelSectionHeader(line)) {
    return false;
  }

  const scopeKey = cached.index.scopeKeyByLine[dirtyLineNo] ?? null;
  const newFingerprint = symbolSiteFingerprint(collectLineSymbolSites(line, schema, scopeKey));
  return newFingerprint === cached.lineFingerprints[dirtyLineNo];
}

export function getSymbolIndex(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
): SymbolIndex | null {
  if (document.lineCount > maxLines) {
    return null;
  }

  const parseEntry = getParsedDocumentEntry(document);
  const hit = indexCache.get(document);
  if (hit && hit.version === document.version) {
    return hit.index;
  }

  if (hit && canReuseSymbolIndex(hit, parseEntry, schema)) {
    indexCache.set(document, {
      version: document.version,
      index: hit.index,
      lineFingerprints: hit.lineFingerprints,
    });
    return hit.index;
  }

  const index = buildSymbolIndex(parseEntry.parsed, schema);
  indexCache.set(document, {
    version: document.version,
    index,
    lineFingerprints: buildLineFingerprints(parseEntry.parsed, schema),
  });
  return index;
}
