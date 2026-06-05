import * as vscode from "vscode";

import { HaproxySchema } from "./schema";
import {
  findAllSites,
  findDefinitions,
  getSymbolIndex,
  resolveSymbolAtPosition,
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

  const symbol = resolveSymbolAtPosition(document, position, schema);
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

  const symbol = resolveSymbolAtPosition(document, position, schema);
  if (!symbol) {
    return [];
  }

  const sites = findAllSites(index, symbol.kind, symbol.name, symbol.scopeKey);
  if (sites.length === 0) {
    return [];
  }

  if (context.includeDeclaration) {
    return sites.map((site) => siteToLocation(document, site));
  }

  return sites
    .filter((site) => site.role === "reference")
    .map((site) => siteToLocation(document, site));
}
