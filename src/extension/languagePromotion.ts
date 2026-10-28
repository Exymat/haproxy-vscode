/** Promotes plaintext documents that match HAProxy section grammar. */
import * as vscode from "vscode";

import { HAPROXY_LANGUAGE_BASE, isHaproxyLanguageId } from "./grammar";
import { detectHaproxyConfig } from "./languageDetection";

const MAX_DOCUMENT_LINES = 400;

const suppressedUris = new Set<string>();
const pendingAutoSwitch = new Set<string>();
const promoting = new Set<string>();
const justClosedFromHaproxy = new Set<string>();
const observedLanguage = new Map<string, string>();

export type OpenDisposition = "haproxy" | "promote" | "ignore";

export function resetLanguagePromotionState(): void {
  suppressedUris.clear();
  pendingAutoSwitch.clear();
  promoting.clear();
  justClosedFromHaproxy.clear();
  observedLanguage.clear();
}

function documentScheme(document: vscode.TextDocument): string {
  if (document.uri.scheme) {
    return document.uri.scheme;
  }
  const match = /^([^:]+):/.exec(document.uri.toString());
  return match?.[1] ?? "";
}

function isScannableDocument(document: vscode.TextDocument): boolean {
  const scheme = documentScheme(document);
  return scheme === "file" || scheme === "untitled";
}

function documentLines(document: vscode.TextDocument): string[] {
  const count = Math.min(document.lineCount, MAX_DOCUMENT_LINES);
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(document.lineAt(index).text);
  }
  return lines;
}

function wasHaproxyDocument(key: string, languageId: string): boolean {
  const previous = observedLanguage.get(key);
  return (
    (previous !== undefined && isHaproxyLanguageId(previous)) || isHaproxyLanguageId(languageId)
  );
}

/** Records a close so a following plaintext open can be treated as a user override. */
export function noteTextDocumentClosed(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  if (pendingAutoSwitch.delete(key)) {
    return;
  }
  if (!wasHaproxyDocument(key, document.languageId) && !suppressedUris.has(key)) {
    return;
  }
  justClosedFromHaproxy.add(key);
  queueMicrotask(() => {
    if (!justClosedFromHaproxy.delete(key)) {
      return;
    }
    suppressedUris.delete(key);
    observedLanguage.delete(key);
  });
}

/**
 * Updates override state for a newly opened document.
 * Plaintext that follows a HAProxy close in the same turn stays plaintext.
 */
export function beginTextDocumentOpen(document: vscode.TextDocument): OpenDisposition {
  const key = document.uri.toString();
  const closedFromHaproxy = justClosedFromHaproxy.delete(key);
  if (closedFromHaproxy && !isHaproxyLanguageId(document.languageId)) {
    if (document.languageId === "plaintext") {
      suppressedUris.add(key);
    }
    observedLanguage.set(key, document.languageId);
    return "ignore";
  }
  observedLanguage.set(key, document.languageId);
  if (
    (document.languageId === "plaintext" || document.languageId === "properties") &&
    isScannableDocument(document) &&
    !suppressedUris.has(key)
  ) {
    return "promote";
  }
  if (isHaproxyLanguageId(document.languageId)) {
    return "haproxy";
  }
  return "ignore";
}

async function applyHaproxyLanguage(document: vscode.TextDocument, key: string): Promise<boolean> {
  promoting.add(key);
  pendingAutoSwitch.add(key);
  try {
    await vscode.languages.setTextDocumentLanguage(document, HAPROXY_LANGUAGE_BASE);
    return true;
  } catch {
    return false;
  } finally {
    promoting.delete(key);
    pendingAutoSwitch.delete(key);
  }
}

/** Sets the HAProxy language when a plaintext document matches section grammar. */
export async function promotePlaintextDocument(document: vscode.TextDocument): Promise<boolean> {
  const key = document.uri.toString();
  if (
    promoting.has(key) ||
    suppressedUris.has(key) ||
    (document.languageId !== "plaintext" && document.languageId !== "properties")
  ) {
    return false;
  }
  if (!isScannableDocument(document) || !detectHaproxyConfig(documentLines(document))) {
    return false;
  }
  return applyHaproxyLanguage(document, key);
}

export function considerPlaintextEdit(document: vscode.TextDocument): void {
  if (
    (document.languageId !== "plaintext" && document.languageId !== "properties") ||
    !isScannableDocument(document)
  ) {
    return;
  }
  if (suppressedUris.has(document.uri.toString())) {
    return;
  }
  void promotePlaintextDocument(document);
}

export function promoteOpenPlaintextDocuments(): void {
  for (const document of [...vscode.workspace.textDocuments]) {
    if (beginTextDocumentOpen(document) === "promote") {
      void promotePlaintextDocument(document);
    }
  }
}
