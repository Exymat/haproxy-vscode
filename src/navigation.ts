import * as vscode from "vscode";

import { getParsedDocument } from "./parseCache";
import { HaproxySchema, sectionHeaderSet } from "./schema";
import { sectionOutlineByStartLine, SectionSymbolInfo } from "./sectionOutline";
import {
  findDefinitions,
  findReferences,
  findSiteAtPosition,
  getSymbolIndex,
  resolveSymbolAtPosition,
  SymbolSite,
} from "./symbolIndex";

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
  const parsed = getParsedDocument(document, {
    sectionHeaders: sectionHeaderSet(schema),
  });
  return sectionOutlineByStartLine(document, parsed);
}

function siteToLocation(document: vscode.TextDocument, site: SymbolSite): vscode.Location {
  return new vscode.Location(
    document.uri,
    new vscode.Range(site.line, site.start, site.line, site.end),
  );
}

function siteToDefinitionTarget(
  document: vscode.TextDocument,
  site: SymbolSite,
  sectionsByStartLine: Map<number, SectionSymbolInfo>,
): DefinitionResult {
  const selectionRange = new vscode.Range(site.line, site.start, site.line, site.end);
  if (site.role === "definition") {
    const section = sectionsByStartLine.get(site.line);
    if (section) {
      return {
        targetUri: document.uri,
        targetRange: new vscode.Range(section.startLine, 0, section.endLine, section.endColumn),
        targetSelectionRange: selectionRange,
      };
    }
  }
  return siteToLocation(document, site);
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

  const definitions = findDefinitions(index, symbol.kind, symbol.name, symbol.scopeKey);
  if (definitions.length === 0) {
    return null;
  }

  const sectionsByStartLine = sectionOutlineForDocument(document, schema);
  const targets = definitions.map((site) =>
    siteToDefinitionTarget(document, site, sectionsByStartLine),
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
