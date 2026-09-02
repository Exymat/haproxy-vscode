/** Shared live and URI-backed storage for per-document derived session state. */
import * as vscode from "vscode";

import { fingerprintText } from "../core/contentFingerprint";
import { UriLruCache } from "../core/uriLruCache";
import { normalizeUriKey } from "../core/uriKey";
import type { RuntimeModeCacheEntry } from "../parser/sectionMode";
import type { ConditionalLineInfo } from "../parser/conditionalDirectives";
import type { DocumentAnalysis } from "../parser/documentAnalysis";
import type { ParsedDocumentEntry } from "../parser/parseIncremental";
import type { HaproxySchema } from "../schema/types";
import type { SymbolIndex } from "../symbolIndex/types";

export interface DocumentSessionSymbols {
  index: SymbolIndex | null;
  lineFingerprints: string[];
  maxLines: number;
  version: number;
}

export interface DocumentSessionRecord {
  generation: number;
  optionsKey: string;
  version: number;
  schema: HaproxySchema | undefined;
  parse: ParsedDocumentEntry;
  analysis?: DocumentAnalysis;
  modes?: RuntimeModeCacheEntry;
  branches?: ConditionalLineInfo[];
  hasLuaLoad?: boolean;
  symbols?: DocumentSessionSymbols;
}

const live = new WeakMap<vscode.TextDocument, Map<string, DocumentSessionRecord>>();
const liveGeneration = new WeakMap<vscode.TextDocument, number>();
const uriCache = new UriLruCache<DocumentSessionRecord>(64);
let generation = 0;

export function documentSessionGeneration(): number {
  return generation;
}

function forgetStaleLiveSessions(
  document: vscode.TextDocument,
): Map<string, DocumentSessionRecord> {
  if (liveGeneration.get(document) !== generation) {
    live.delete(document);
    liveGeneration.set(document, generation);
  }
  let sessions = live.get(document);
  if (!sessions) {
    sessions = new Map();
    live.set(document, sessions);
  }
  return sessions;
}

export function getLiveSession(
  document: vscode.TextDocument,
  optionsKey: string,
): DocumentSessionRecord | undefined {
  return forgetStaleLiveSessions(document).get(optionsKey);
}

export function setLiveSession(document: vscode.TextDocument, record: DocumentSessionRecord): void {
  forgetStaleLiveSessions(document).set(record.optionsKey, record);
}

export function liveSessionsForDocument(
  document: vscode.TextDocument,
): Map<string, DocumentSessionRecord> | undefined {
  if (liveGeneration.get(document) !== generation) {
    return undefined;
  }
  return live.get(document);
}

export function getUriSession(
  uriKey: string,
  fingerprint: string,
): DocumentSessionRecord | undefined {
  return uriCache.get(uriKey, fingerprint);
}

export function setUriSession(
  uriKey: string,
  fingerprint: string,
  record: DocumentSessionRecord,
): void {
  uriCache.set(uriKey, fingerprint, record);
}

export function hasUriSession(uriKey: string, fingerprint: string): boolean {
  return uriCache.get(uriKey, fingerprint) !== undefined;
}

export function hasUriSessionKey(uriKey: string): boolean {
  return uriCache.has(uriKey);
}

export function uriSessionHasSymbols(uriKey: string, fingerprint: string): boolean {
  return uriCache.get(uriKey, fingerprint)?.symbols !== undefined;
}

export function clearDocumentSessions(): void {
  generation += 1;
  uriCache.clear();
}

export function persistDocumentSession(document: vscode.TextDocument, fingerprint: string): void {
  const sessions = live.get(document);
  if (!sessions || sessions.size === 0) {
    return;
  }
  const uriKey = normalizeUriKey(document.uri);
  for (const record of sessions.values()) {
    uriCache.set(uriKey, fingerprint, record);
  }
}

export function finalizeDocumentSessionForClose(document: vscode.TextDocument): void {
  const sessions = live.get(document);
  if (!sessions || sessions.size === 0) {
    return;
  }
  persistDocumentSession(document, fingerprintText(document.getText()));
}
