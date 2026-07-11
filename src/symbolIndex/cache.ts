import * as vscode from "vscode";

import { documentContentFingerprint, documentUriKey } from "../parser/documentUriKey";
import { getParsedDocumentEntry, ParsedDocumentEntry } from "../parser/parseCache";
import { isTopLevelSectionHeader } from "../language/sectionUtils";
import { HaproxySchema } from "../schema/types";
import { sectionHeaderSet } from "../schema/layout";
import { UriLruCache } from "../core/uriLruCache";

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
  schema: HaproxySchema;
  index: SymbolIndex;
  lineFingerprints: string[];
}

let indexCache = new WeakMap<vscode.TextDocument, IndexCacheEntry>();
const uriIndexCache = new UriLruCache<IndexCacheEntry>(64);

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

function storeIndexCache(document: vscode.TextDocument, entry: IndexCacheEntry): void {
  indexCache.set(document, entry);
  uriIndexCache.set(documentUriKey(document), documentContentFingerprint(document), entry);
}

function hasSchemaIdentity(entry: IndexCacheEntry | undefined, schema: HaproxySchema): boolean {
  return entry?.schema === schema;
}

export function getSymbolIndexVersion(document: vscode.TextDocument): number | undefined {
  return indexCache.get(document)?.version;
}

export function hasUriSymbolIndexCache(document: vscode.TextDocument): boolean {
  return (
    uriIndexCache.get(documentUriKey(document), documentContentFingerprint(document)) !== undefined
  );
}

export function clearSymbolIndexCaches(): void {
  indexCache = new WeakMap<vscode.TextDocument, IndexCacheEntry>();
  uriIndexCache.clear();
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
  const matchingHit = hasSchemaIdentity(hit, schema) ? hit : undefined;
  if (matchingHit && matchingHit.version === document.version) {
    return matchingHit.index;
  }

  const uriHit = uriIndexCache.get(documentUriKey(document), documentContentFingerprint(document));
  const matchingUriHit = hasSchemaIdentity(uriHit, schema) ? uriHit : undefined;
  if (matchingUriHit && !matchingHit) {
    const restored = { ...matchingUriHit, version: document.version };
    storeIndexCache(document, restored);
    return restored.index;
  }

  if (matchingHit && canReuseSymbolIndex(matchingHit, parseEntry, schema)) {
    storeIndexCache(document, {
      version: document.version,
      schema,
      index: matchingHit.index,
      lineFingerprints: matchingHit.lineFingerprints,
    });
    return matchingHit.index;
  }

  if (matchingHit && canIncrementalPatch(parseEntry)) {
    const dirtyLineNo = parseEntry.reuse.prefixLines;
    const line = parseEntry.parsed[dirtyLineNo];
    if (line) {
      const scopeKey = matchingHit.index.scopeKeyByLine[dirtyLineNo] ?? null;
      const buildContext = createSymbolBuildContext(schema);
      const sites = collectLineSymbolSites(line, schema, scopeKey, buildContext);
      const { index, lineFingerprints } = patchSymbolIndexLine(
        matchingHit.index,
        line,
        sites,
        buildContext,
      );
      const nextFingerprints = [...matchingHit.lineFingerprints];
      nextFingerprints[dirtyLineNo] = lineFingerprints[0] ?? "";
      storeIndexCache(document, {
        version: document.version,
        schema,
        index,
        lineFingerprints: nextFingerprints,
      });
      return index;
    }
  }

  const { index, lineFingerprints } = buildSymbolIndexWithFingerprints(parseEntry.parsed, schema, {
    computeFingerprints: Boolean(matchingHit || matchingUriHit),
    buildSitesByLine: Boolean(matchingHit || matchingUriHit),
  });
  storeIndexCache(document, {
    version: document.version,
    schema,
    index,
    lineFingerprints,
  });
  return index;
}
