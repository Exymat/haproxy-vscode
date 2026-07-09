import type * as vscode from "vscode";

import type { ParsedLine } from "../parser";

import type { SymbolIndex, SymbolKind, SymbolSite } from "./types";

export interface WorkspaceSymbolSettings {
  enabled: boolean;
  include: string[];
  exclude: string[];
  maxFiles: number;
  maxTotalLines: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxLineBytes: number;
  debounceMs: number;
}

export type WorkspaceRebuildScope = "full" | "content" | "incremental" | "none";

export interface WorkspaceRebuildOptions {
  scope?: WorkspaceRebuildScope;
  document?: vscode.TextDocument;
  uri?: vscode.Uri;
}

export interface WorkspaceSymbolSite extends SymbolSite {
  uri: vscode.Uri;
  uriKey: string;
}

export interface SectionRange {
  endLine: number;
  endColumn: number;
}

export interface WorkspaceDocumentSymbols {
  uri: vscode.Uri;
  uriKey: string;
  version: number | null;
  fingerprint: string;
  diskStatKey: string | null;
  byteLength: number;
  parsed: ParsedLine[];
  lineTexts: string[];
  index: SymbolIndex;
  sectionRangesByStartLine: Map<number, SectionRange>;
}

export interface WorkspaceSymbolIndex {
  generation: number;
  capped: boolean;
  documents: Map<string, WorkspaceDocumentSymbols>;
  definitions: Map<string, WorkspaceSymbolSite[]>;
  references: WorkspaceSymbolSite[];
  referencesByKey: Map<string, WorkspaceSymbolSite[]>;
  scopedSymbolKinds: Set<SymbolKind>;
}

export interface WorkspaceIndexChangeEvent {
  scope: WorkspaceRebuildScope;
  document?: vscode.TextDocument;
}

export interface FolderRef {
  folder: vscode.WorkspaceFolder | undefined;
  folderKey: string;
}
