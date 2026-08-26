/** Exposes workspace symbol definitions through VS Code workspace symbol search. */
import * as vscode from "vscode";

import {
  getWorkspaceSymbolIndexes,
  workspaceSiteRange,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSite,
} from "../symbolIndex";

function sectionHeaderForSite(
  workspaceIndex: WorkspaceSymbolIndex,
  site: WorkspaceSymbolSite,
): string | undefined {
  return workspaceIndex.documents.get(site.uriKey)?.parsed[site.line]?.tokens[0]?.text;
}

function symbolKindForSite(
  workspaceIndex: WorkspaceSymbolIndex,
  site: WorkspaceSymbolSite,
): vscode.SymbolKind {
  const header = sectionHeaderForSite(workspaceIndex, site)?.toLowerCase();
  if (header === "backend") {
    return vscode.SymbolKind.Class;
  }
  if (header === "frontend") {
    return vscode.SymbolKind.Interface;
  }
  if (header === "listen") {
    return vscode.SymbolKind.Module;
  }

  if (header === "defaults") {
    return vscode.SymbolKind.Struct;
  }
  return vscode.SymbolKind.Namespace;
}

function siteToSymbolInformation(
  workspaceIndex: WorkspaceSymbolIndex,
  site: WorkspaceSymbolSite,
): vscode.SymbolInformation {
  const sectionRange = workspaceSiteRange(workspaceIndex, site);
  const endLine = sectionRange?.endLine ?? site.line;
  const endColumn = sectionRange?.endColumn ?? site.end;
  const header = sectionHeaderForSite(workspaceIndex, site);
  const container = header ? `${header} ${site.name}` : site.name;
  return new vscode.SymbolInformation(
    site.name,
    symbolKindForSite(workspaceIndex, site),
    container,
    new vscode.Location(site.uri, new vscode.Range(site.line, site.start, endLine, endColumn)),
  );
}

export function provideWorkspaceSymbols(query: string): vscode.SymbolInformation[] {
  const workspaceIndexes = getWorkspaceSymbolIndexes();
  if (workspaceIndexes.length === 0) {
    return [];
  }

  const needle = query.trim().toLowerCase();
  const results: vscode.SymbolInformation[] = [];
  const seen = new Set<string>();

  for (const workspaceIndex of workspaceIndexes) {
    for (const sites of workspaceIndex.definitions.values()) {
      for (const site of sites) {
        if (site.role !== "definition") {
          continue;
        }
        if (needle) {
          const header = sectionHeaderForSite(workspaceIndex, site)?.toLowerCase() ?? "";
          const haystack = `${site.name} ${header} ${site.kind}`.toLowerCase();
          if (!haystack.includes(needle)) {
            continue;
          }
        }
        const key = `${site.uriKey}\0${site.kind}\0${site.name}\0${site.line}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        results.push(siteToSymbolInformation(workspaceIndex, site));
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
