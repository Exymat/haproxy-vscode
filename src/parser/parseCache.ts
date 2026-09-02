/** LRU-caches parsed documents with incremental reuse across edits. */
import * as vscode from "vscode";

import { fingerprintText } from "../core/contentFingerprint";
import { normalizeUriKey } from "../core/uriKey";
import {
  DocumentSessionRecord,
  documentSessionGeneration,
  getLiveSession,
  setLiveSession,
  getUriSession,
  hasUriSession,
  hasUriSessionKey,
  clearDocumentSessions,
  finalizeDocumentSessionForClose,
} from "../document/sessionStore";
import { ParseOptions, ParsedLine } from "./index";
import {
  parseDocumentFresh,
  parseDocumentIncremental,
  parseOptionsKey,
  restoredParseReuse,
  ParsedDocumentEntry,
} from "./parseIncremental";

export type { ParsedDocumentEntry, ParsedDocumentReuse } from "./parseIncremental";
export { parseOptionsKey } from "./parseIncremental";

function restoreUriParse(
  document: vscode.TextDocument,
  optionsKey: string,
  uriHit: DocumentSessionRecord,
): ParsedDocumentEntry {
  const restored: DocumentSessionRecord = {
    ...uriHit,
    generation: documentSessionGeneration(),
    version: document.version,
    parse: {
      ...uriHit.parse,
      version: document.version,
      reuse: restoredParseReuse(uriHit.parse.parsed.length, uriHit.parse.version),
    },
    analysis: undefined,
    modes: undefined,
    branches: undefined,
    hasLuaLoad: undefined,
  };
  setLiveSession(document, restored);
  return restored.parse;
}

function storeParseRecord(
  document: vscode.TextDocument,
  optionsKey: string,
  parse: ParsedDocumentEntry,
  previous: DocumentSessionRecord | undefined,
): DocumentSessionRecord {
  const record: DocumentSessionRecord = {
    generation: documentSessionGeneration(),
    optionsKey,
    version: document.version,
    schema: previous?.schema,
    parse,
    modes: previous?.modes,
    symbols: previous?.symbols,
  };
  setLiveSession(document, record);
  return record;
}

export function getParsedDocumentEntry(
  document: vscode.TextDocument,
  options?: ParseOptions,
): ParsedDocumentEntry {
  const optionsKey = parseOptionsKey(options);
  const liveHit = getLiveSession(document, optionsKey);
  if (liveHit && liveHit.version === document.version) {
    return liveHit.parse;
  }

  if (!liveHit) {
    const uriKey = normalizeUriKey(document.uri);
    if (hasUriSessionKey(uriKey)) {
      const uriHit = getUriSession(uriKey, fingerprintText(document.getText()));
      if (uriHit && uriHit.optionsKey === optionsKey) {
        return restoreUriParse(document, optionsKey, uriHit);
      }
    }
  }

  const parse = liveHit
    ? parseDocumentIncremental(liveHit.parse, document, options)
    : parseDocumentFresh(document, options);
  return storeParseRecord(document, optionsKey, parse, liveHit).parse;
}

export function getParsedDocument(
  document: vscode.TextDocument,
  options?: ParseOptions,
): ParsedLine[] {
  return getParsedDocumentEntry(document, options).parsed;
}

export function hasUriParseCache(document: vscode.TextDocument): boolean {
  const uriKey = normalizeUriKey(document.uri);
  return hasUriSessionKey(uriKey) && hasUriSession(uriKey, fingerprintText(document.getText()));
}

export function clearParseCache(): void {
  clearDocumentSessions();
}

export { finalizeDocumentSessionForClose as finalizeParseCacheForClosedDocument };
