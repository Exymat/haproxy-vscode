/** Maps HAProxy versions to language IDs and syncs TextMate grammar languages. */
import * as path from "path";
import * as vscode from "vscode";

import {
  DEFAULT_HAPROXY_EDITION,
  getConfiguredEditionForUri,
  getConfiguredVersionForUri,
  HAPEE_SCHEMA_VERSIONS,
  HaproxyEdition,
  HaproxyVersion,
  schemaArtifactId,
  SUPPORTED_HAPROXY_VERSIONS,
} from "./version";

export const HAPROXY_LANGUAGE_BASE = "haproxy";

export function grammarPathForVersion(
  extensionPath: string,
  version: HaproxyVersion,
  edition: HaproxyEdition = DEFAULT_HAPROXY_EDITION,
): string {
  return path.join(
    extensionPath,
    "syntaxes",
    `haproxy-${schemaArtifactId(version, edition)}.tmLanguage.json`,
  );
}

export function languageIdForVersion(
  version: HaproxyVersion,
  edition: HaproxyEdition = DEFAULT_HAPROXY_EDITION,
): string {
  return `haproxy-${schemaArtifactId(version, edition)}`;
}

export function versionForLanguageId(languageId: string): HaproxyVersion | undefined {
  const match = /^haproxy-(\d+\.\d+)(r1)?$/.exec(languageId);
  if (!match) {
    return undefined;
  }
  const version = match[1];
  if (match[2]) {
    return HAPEE_SCHEMA_VERSIONS.includes(version) ? version : undefined;
  }
  return SUPPORTED_HAPROXY_VERSIONS.includes(version) ? version : undefined;
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
    ...HAPEE_SCHEMA_VERSIONS.map((version) => ({
      language: languageIdForVersion(version, "hapee"),
    })),
  ];
}

/** Assign the TextMate grammar language for a document from its workspace folder version. */
export async function syncDocumentGrammarLanguage(document: vscode.TextDocument): Promise<boolean> {
  if (!isHaproxyLanguageId(document.languageId)) {
    return false;
  }
  const targetLanguageId = languageIdForVersion(
    getConfiguredVersionForUri(document.uri),
    getConfiguredEditionForUri(document.uri),
  );
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
