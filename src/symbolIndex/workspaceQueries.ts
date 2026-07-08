import * as vscode from "vscode";

import { SymbolIndex, SymbolKind, symbolKeyForScopedKinds, SymbolSite } from "./types";
import { SectionRange, WorkspaceSymbolIndex, WorkspaceSymbolSite } from "./workspaceTypes";
import { workspaceUriKey } from "./workspaceUri";

export function findWorkspaceDefinitions(
  workspaceIndex: WorkspaceSymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): WorkspaceSymbolSite[] {
  const key = symbolKeyForScopedKinds(workspaceIndex.scopedSymbolKinds, kind, name, scopeKey);
  return workspaceIndex.definitions.get(key) ?? [];
}

export function findWorkspaceReferences(
  workspaceIndex: WorkspaceSymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): WorkspaceSymbolSite[] {
  const key = symbolKeyForScopedKinds(workspaceIndex.scopedSymbolKinds, kind, name, scopeKey);
  return workspaceIndex.referencesByKey.get(key) ?? [];
}

export function findAllWorkspaceSites(
  workspaceIndex: WorkspaceSymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): WorkspaceSymbolSite[] {
  const definitions = findWorkspaceDefinitions(workspaceIndex, kind, name, scopeKey);
  const references = findWorkspaceReferences(workspaceIndex, kind, name, scopeKey);
  return [...definitions, ...references];
}

export function workspaceSiteRange(
  workspaceIndex: WorkspaceSymbolIndex,
  site: WorkspaceSymbolSite,
): SectionRange | undefined {
  return workspaceIndex.documents.get(site.uriKey)?.sectionRangesByStartLine.get(site.line);
}

export function workspaceSiteText(
  workspaceIndex: WorkspaceSymbolIndex,
  site: WorkspaceSymbolSite,
): string | undefined {
  const document = workspaceIndex.documents.get(site.uriKey);
  if (!document) {
    return undefined;
  }

  if (site.role !== "definition") {
    return document.lineTexts[site.line];
  }

  const range = workspaceSiteRange(workspaceIndex, site);
  if (!range) {
    return document.lineTexts[site.line];
  }

  return document.lineTexts.slice(site.line, range.endLine + 1).join("\n");
}

function localReferencesMissingInWorkspace(
  localIndex: SymbolIndex,
  workspaceIndex: WorkspaceSymbolIndex,
): SymbolSite[] {
  const unresolved: SymbolSite[] = [];
  for (const reference of localIndex.references) {
    const key = symbolKeyForScopedKinds(
      localIndex.scopedSymbolKinds,
      reference.kind,
      reference.name,
      reference.scopeKey,
    );
    if (!workspaceIndex.definitions.has(key)) {
      unresolved.push(reference);
    }
  }
  return unresolved;
}

export function symbolIndexForWorkspaceDiagnostics(
  document: vscode.TextDocument,
  localIndex: SymbolIndex,
  workspaceIndex: WorkspaceSymbolIndex | null,
): SymbolIndex {
  if (!workspaceIndex || !workspaceIndex.documents.has(workspaceUriKey(document.uri))) {
    return localIndex;
  }

  return {
    definitions: localIndex.definitions,
    references: localIndex.references,
    referencesByKey: workspaceIndex.referencesByKey,
    scopeKeyByLine: localIndex.scopeKeyByLine,
    scopedSymbolKinds: localIndex.scopedSymbolKinds,
    sitesByLine: localIndex.sitesByLine,
    unresolvedReferences: localReferencesMissingInWorkspace(localIndex, workspaceIndex),
  };
}
