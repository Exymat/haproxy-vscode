import * as vscode from "vscode";

import { getParsedDocumentEntry, ParsedDocumentEntry } from "../parseCache";
import { isTopLevelSectionHeader } from "../sectionUtils";
import { HaproxySchema, sectionHeaderSet } from "../schema";

import {
  buildSymbolIndexWithFingerprints,
  collectLineSymbolSites,
  patchSymbolIndexLine,
  symbolSiteFingerprint,
} from "./build";
import { createSymbolBuildContext } from "./context";
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

function singleDirtyLineNo(parseEntry: ParsedDocumentEntry): number | null {
  if (dirtyLineCount(parseEntry) !== 1) {
    return null;
  }
  return parseEntry.reuse.prefixLines;
}

function canReuseSymbolIndex(
  cached: IndexCacheEntry,
  parseEntry: ParsedDocumentEntry,
  schema: HaproxySchema,
): boolean {
  const dirtyLineNo = singleDirtyLineNo(parseEntry);
  if (dirtyLineNo === null) {
    return false;
  }

  const { reuse, parsed } = parseEntry;
  if (reuse.previousVersion === null) {
    return false;
  }
  if (parsed.length !== cached.lineFingerprints.length) {
    return false;
  }

  const line = parsed[dirtyLineNo];
  if (!line || isTopLevelSectionHeader(line)) {
    return false;
  }

  const scopeKey = cached.index.scopeKeyByLine[dirtyLineNo] ?? null;
  const buildContext = createSymbolBuildContext(schema);
  const newFingerprint = symbolSiteFingerprint(
    collectLineSymbolSites(line, schema, scopeKey, buildContext),
  );
  return newFingerprint === cached.lineFingerprints[dirtyLineNo];
}

function canIncrementalPatch(parseEntry: ParsedDocumentEntry): boolean {
  const dirtyLineNo = singleDirtyLineNo(parseEntry);
  if (dirtyLineNo === null) {
    return false;
  }
  const line = parseEntry.parsed[dirtyLineNo];
  return Boolean(line && !isTopLevelSectionHeader(line));
}

export function getSymbolIndexVersion(document: vscode.TextDocument): number | undefined {
  return indexCache.get(document)?.version;
}

export function getSymbolIndex(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
): SymbolIndex | null {
  if (document.lineCount > maxLines) {
    return null;
  }

  const parseEntry = getParsedDocumentEntry(document, {
    sectionHeaders: sectionHeaderSet(schema),
  });
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

  if (hit && canIncrementalPatch(parseEntry)) {
    const dirtyLineNo = parseEntry.reuse.prefixLines;
    const line = parseEntry.parsed[dirtyLineNo];
    if (line) {
      const scopeKey = hit.index.scopeKeyByLine[dirtyLineNo] ?? null;
      const buildContext = createSymbolBuildContext(schema);
      const sites = collectLineSymbolSites(line, schema, scopeKey, buildContext);
      const { index, lineFingerprints } = patchSymbolIndexLine(
        hit.index,
        line,
        sites,
        buildContext,
      );
      const nextFingerprints = [...hit.lineFingerprints];
      nextFingerprints[dirtyLineNo] = lineFingerprints[0] ?? "";
      indexCache.set(document, {
        version: document.version,
        index,
        lineFingerprints: nextFingerprints,
      });
      return index;
    }
  }

  const { index, lineFingerprints } = buildSymbolIndexWithFingerprints(parseEntry.parsed, schema, {
    computeFingerprints: Boolean(hit),
    buildSitesByLine: Boolean(hit),
  });
  indexCache.set(document, {
    version: document.version,
    index,
    lineFingerprints,
  });
  return index;
}
