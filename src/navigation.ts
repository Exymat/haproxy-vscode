import * as vscode from "vscode";

import { HaproxySchema } from "./schema";
import {
  findDefinitions,
  findReferences,
  findSiteAtPosition,
  getSymbolIndex,
  SymbolSite,
} from "./symbolIndex";

function siteToLocation(document: vscode.TextDocument, site: SymbolSite): vscode.Location {
  return new vscode.Location(
    document.uri,
    new vscode.Range(site.line, site.start, site.line, site.end),
  );
}

export function provideDefinition(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  maxLines: number,
): vscode.Location | vscode.Location[] | null {
  const index = getSymbolIndex(document, schema, maxLines);
  if (!index) {
    return null;
  }

  const symbol = findSiteAtPosition(index, position);
  if (!symbol) {
    return null;
  }

  const definitions = findDefinitions(index, symbol.kind, symbol.name, symbol.scopeKey);
  if (definitions.length === 0) {
    return null;
  }

  if (definitions.length === 1) {
    return siteToLocation(document, definitions[0]);
  }

  return definitions.map((site) => siteToLocation(document, site));
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

  const symbol = findSiteAtPosition(index, position);
  if (!symbol) {
    return [];
  }

  if (context.includeDeclaration) {
    const definitions = findDefinitions(index, symbol.kind, symbol.name, symbol.scopeKey);
    const references = findReferences(index, symbol.kind, symbol.name, symbol.scopeKey);
    if (definitions.length === 0 && references.length === 0) {
      return [];
    }
    return [...definitions, ...references].map((site) => siteToLocation(document, site));
  }

  const references = findReferences(index, symbol.kind, symbol.name, symbol.scopeKey);
  if (references.length === 0) {
    return [];
  }

  return references.map((site) => siteToLocation(document, site));
}
