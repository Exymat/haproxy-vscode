import * as vscode from "vscode";

import { findDefinitions, findSiteAtPosition, getSymbolIndex, SymbolSite } from "../../symbolIndex";
import { HoverContext } from "../types";

function symbolRange(site: SymbolSite): vscode.Range {
  return new vscode.Range(site.line, site.start, site.line, site.end);
}

function isDefinitionSite(site: SymbolSite, definition: SymbolSite): boolean {
  return (
    site.line === definition.line && site.start === definition.start && site.end === definition.end
  );
}

export function trySymbolHover(hc: HoverContext): vscode.Hover | null {
  const maxLines = hc.maxSymbolLines ?? hc.document.lineCount;
  const index = getSymbolIndex(hc.document, hc.schema, maxLines);
  if (!index) {
    return null;
  }

  const site = findSiteAtPosition(index, hc.position);
  if (!site) {
    return null;
  }

  const definitions = findDefinitions(index, site.kind, site.name, site.scopeKey);
  const definition = definitions[0];
  if (!definition || definitions.some((def) => isDefinitionSite(site, def))) {
    return null;
  }

  const definitionText = hc.document.lineAt(definition.line).text;
  const md = new vscode.MarkdownString();
  md.appendMarkdown(["```haproxy", definitionText, "```"].join("\n"));

  return new vscode.Hover(md, symbolRange(site));
}
