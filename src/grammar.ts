import * as path from "path";
import * as vscode from "vscode";

import { getConfiguredVersionForUri, HaproxyVersion, SUPPORTED_HAPROXY_VERSIONS } from "./version";

export const HAPROXY_LANGUAGE_BASE = "haproxy";

export function grammarPathForVersion(extensionPath: string, version: HaproxyVersion): string {
  return path.join(extensionPath, "syntaxes", `haproxy-${version}.tmLanguage.json`);
}

export function languageIdForVersion(version: HaproxyVersion): string {
  return `haproxy-${version}`;
}

export function versionForLanguageId(languageId: string): HaproxyVersion | undefined {
  const match = /^haproxy-(\d+\.\d+)$/.exec(languageId);
  if (!match) {
    return undefined;
  }
  return (SUPPORTED_HAPROXY_VERSIONS as readonly string[]).includes(match[1])
    ? (match[1] as HaproxyVersion)
    : undefined;
}

export function isHaproxyLanguageId(languageId: string): boolean {
  return languageId === HAPROXY_LANGUAGE_BASE || versionForLanguageId(languageId) !== undefined;
}

export function haproxyDocumentSelector(): vscode.DocumentSelector {
  return [
    { language: HAPROXY_LANGUAGE_BASE },
    ...SUPPORTED_HAPROXY_VERSIONS.map((version) => ({
      language: languageIdForVersion(version),
    })),
  ];
}

/** Assign the TextMate grammar language for a document from its workspace folder version. */
export async function syncDocumentGrammarLanguage(document: vscode.TextDocument): Promise<boolean> {
  if (!isHaproxyLanguageId(document.languageId)) {
    return false;
  }
  const targetLanguageId = languageIdForVersion(getConfiguredVersionForUri(document.uri));
  if (document.languageId === targetLanguageId) {
    return false;
  }
  await vscode.languages.setTextDocumentLanguage(document, targetLanguageId);
  return true;
}

export async function syncAllOpenDocumentGrammarLanguages(): Promise<void> {
  await Promise.all(
    vscode.workspace.textDocuments.map((document) => syncDocumentGrammarLanguage(document)),
  );
}
