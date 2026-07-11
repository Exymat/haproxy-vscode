import * as vscode from "vscode";

import { getDocumentAnalysis } from "../parser/documentAnalysis";
import { HaproxySchema } from "../schema/types";
import { SectionSymbolInfo } from "./sectionOutline";
import {
  findDefinitions,
  findReferences,
  findSiteAtPosition,
  findWorkspaceDefinitions,
  findWorkspaceReferences,
  getSymbolIndex,
  getWorkspaceSymbolIndex,
  resolveSymbolAtPosition,
  SymbolSite,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSite,
  workspaceSiteRange,
  workspaceUriKey,
} from "../symbolIndex";

interface ResolvedNavigationSymbol {
  kind: SymbolSite["kind"];
  name: string;
  scopeKey: string | null;
}

type DefinitionResult = vscode.Location | vscode.LocationLink;

function isLocationLink(target: DefinitionResult): target is vscode.LocationLink {
  return "targetUri" in target;
}

function toProviderResult(
  targets: DefinitionResult[],
): vscode.Definition | vscode.DefinitionLink[] | null {
  if (targets.length === 1) {
    const [target] = targets;
    return isLocationLink(target) ? [target] : target;
  }
  if (targets.every(isLocationLink)) {
    return targets;
  }
  return targets as vscode.Location[];
}

function sectionOutlineForDocument(
  document: vscode.TextDocument,
  schema: HaproxySchema,
): Map<number, SectionSymbolInfo> {
  return getDocumentAnalysis(document, schema).sectionOutlineByStartLine();
}

function siteToLocation(uri: vscode.Uri, site: SymbolSite): vscode.Location {
  return new vscode.Location(uri, new vscode.Range(site.line, site.start, site.line, site.end));
}

function siteToDefinitionTarget(
  uri: vscode.Uri,
  site: SymbolSite,
  sectionsByStartLine: Map<number, SectionSymbolInfo>,
): DefinitionResult {
  const selectionRange = new vscode.Range(site.line, site.start, site.line, site.end);
  if (site.role === "definition") {
    const section = sectionsByStartLine.get(site.line);
    if (section) {
      return {
        targetUri: uri,
        targetRange: new vscode.Range(section.startLine, 0, section.endLine, section.endColumn),
        targetSelectionRange: selectionRange,
      };
    }
  }
  return siteToLocation(uri, site);
}

function workspaceSiteToDefinitionTarget(
  workspaceIndex: WorkspaceSymbolIndex,
  site: WorkspaceSymbolSite,
): DefinitionResult {
  const selectionRange = new vscode.Range(site.line, site.start, site.line, site.end);
  const section = site.role === "definition" ? workspaceSiteRange(workspaceIndex, site) : undefined;
  if (section) {
    return {
      targetUri: site.uri,
      targetRange: new vscode.Range(site.line, 0, section.endLine, section.endColumn),
      targetSelectionRange: selectionRange,
    };
  }
  return siteToLocation(site.uri, site);
}

function resolveNavigationSymbol(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  index: NonNullable<ReturnType<typeof getSymbolIndex>>,
): ResolvedNavigationSymbol | null {
  const site = findSiteAtPosition(index, position);
  if (site) {
    return site;
  }
  return resolveSymbolAtPosition(document, position, schema, index.scopeKeyByLine);
}

function workspaceIndexForDocument(document: vscode.TextDocument): WorkspaceSymbolIndex | null {
  const workspaceIndex = getWorkspaceSymbolIndex(document);
  if (!workspaceIndex?.documents.has(workspaceUriKey(document.uri))) {
    return null;
  }
  return workspaceIndex;
}

export function provideDefinition(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  maxLines: number,
): vscode.Definition | vscode.DefinitionLink[] | null {
  const index = getSymbolIndex(document, schema, maxLines);
  if (!index) {
    return null;
  }

  const symbol = resolveNavigationSymbol(document, position, schema, index);
  if (!symbol) {
    return null;
  }

  const workspaceIndex = workspaceIndexForDocument(document);
  if (workspaceIndex && symbol.kind !== "environment-variable") {
    const definitions = findWorkspaceDefinitions(
      workspaceIndex,
      symbol.kind,
      symbol.name,
      symbol.scopeKey,
    );
    if (definitions.length > 0) {
      return toProviderResult(
        definitions.map((site) => workspaceSiteToDefinitionTarget(workspaceIndex, site)),
      );
    }
  }

  const definitions = findDefinitions(index, symbol.kind, symbol.name, symbol.scopeKey);
  if (definitions.length === 0) {
    return null;
  }

  const sectionsByStartLine = sectionOutlineForDocument(document, schema);
  const targets = definitions.map((site) =>
    siteToDefinitionTarget(document.uri, site, sectionsByStartLine),
  );
  return toProviderResult(targets);
}

export function provideReferences(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: vscode.ReferenceContext,
  schema: HaproxySchema,
  maxLines: number,
): vscode.Location[] {
  const index = getSymbolIndex(document, schema, maxLines);
  if (!index) {
    return [];
  }

  const symbol = resolveNavigationSymbol(document, position, schema, index);
  if (!symbol) {
    return [];
  }

  const workspaceIndex = workspaceIndexForDocument(document);
  if (workspaceIndex && symbol.kind !== "environment-variable") {
    const references = findWorkspaceReferences(
      workspaceIndex,
      symbol.kind,
      symbol.name,
      symbol.scopeKey,
    );
    if (context.includeDeclaration) {
      const definitions = findWorkspaceDefinitions(
        workspaceIndex,
        symbol.kind,
        symbol.name,
        symbol.scopeKey,
      );
      return [...definitions, ...references].map((site) => siteToLocation(site.uri, site));
    }
    return references.map((site) => siteToLocation(site.uri, site));
  }

  if (context.includeDeclaration) {
    const definitions = findDefinitions(index, symbol.kind, symbol.name, symbol.scopeKey);
    const references = findReferences(index, symbol.kind, symbol.name, symbol.scopeKey);
    if (definitions.length === 0 && references.length === 0) {
      return [];
    }
    return [...definitions, ...references].map((site) => siteToLocation(document.uri, site));
  }

  const references = findReferences(index, symbol.kind, symbol.name, symbol.scopeKey);
  if (references.length === 0) {
    return [];
  }

  return references.map((site) => siteToLocation(document.uri, site));
}
