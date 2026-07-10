import * as vscode from "vscode";

import { getParsedDocument } from "../../parseCache";
import { sectionHeaderSet } from "../../schema/layout";
import { sectionOutlineByStartLine, sectionText } from "../../sectionOutline";
import {
  findDefinitions,
  findSiteAtPosition,
  findWorkspaceDefinitions,
  getSymbolIndex,
  getWorkspaceSymbolIndex,
  SymbolSite,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSite,
  workspaceSiteText,
  workspaceUriKey,
} from "../../symbolIndex";
import { HoverContext } from "../types";

function symbolRange(site: SymbolSite): vscode.Range {
  return new vscode.Range(site.line, site.start, site.line, site.end);
}

function isDefinitionSite(site: SymbolSite, definition: SymbolSite): boolean {
  return (
    site.line === definition.line && site.start === definition.start && site.end === definition.end
  );
}

function isWorkspaceDefinitionSite(
  document: vscode.TextDocument,
  site: SymbolSite,
  definition: WorkspaceSymbolSite,
): boolean {
  return definition.uriKey === workspaceUriKey(document.uri) && isDefinitionSite(site, definition);
}

function commandUri(document: vscode.TextDocument, site: SymbolSite): string {
  const args = encodeURIComponent(JSON.stringify([document.uri.toString(), site.line, site.start]));
  return `command:haproxy.peekDefinitionAtPosition?${args}`;
}

function definitionPreviewText(hc: HoverContext, definition: SymbolSite): string {
  if (definition.role !== "definition") {
    return hc.document.lineAt(definition.line).text;
  }
  const parsed = getParsedDocument(hc.document, {
    sectionHeaders: sectionHeaderSet(hc.schema),
  });
  const section = sectionOutlineByStartLine(hc.document, parsed).get(definition.line);
  if (!section) {
    return hc.document.lineAt(definition.line).text;
  }
  return sectionText(hc.document, section);
}

function workspaceDefinitionPreviewText(
  workspaceIndex: WorkspaceSymbolIndex,
  definition: WorkspaceSymbolSite,
): string | undefined {
  return workspaceSiteText(workspaceIndex, definition);
}

function workspaceSymbolHover(
  hc: HoverContext,
  site: SymbolSite,
  workspaceIndex: WorkspaceSymbolIndex,
): vscode.Hover | null {
  if (!workspaceIndex.documents.has(workspaceUriKey(hc.document.uri))) {
    return null;
  }

  const definitions = findWorkspaceDefinitions(workspaceIndex, site.kind, site.name, site.scopeKey);
  if (
    !definitions.length ||
    definitions.some((def) => isWorkspaceDefinitionSite(hc.document, site, def))
  ) {
    return null;
  }

  const definition = definitions[0];
  const definitionText = workspaceDefinitionPreviewText(workspaceIndex, definition);
  if (!definitionText) {
    return null;
  }

  const md = new vscode.MarkdownString();
  md.appendCodeblock(definitionText, "haproxy");
  md.appendMarkdown(`\n\n[Peek Definition](${commandUri(hc.document, site)})`);
  md.isTrusted = { enabledCommands: ["haproxy.peekDefinitionAtPosition"] };

  return new vscode.Hover(md, symbolRange(site));
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

  const workspaceIndex = getWorkspaceSymbolIndex(hc.document);
  if (workspaceIndex) {
    const hover = workspaceSymbolHover(hc, site, workspaceIndex);
    if (hover) {
      return hover;
    }
  }

  const definitions = findDefinitions(index, site.kind, site.name, site.scopeKey);
  const definition = definitions[0];
  if (!definition || definitions.some((def) => isDefinitionSite(site, def))) {
    return null;
  }

  const definitionText = definitionPreviewText(hc, definition);
  const md = new vscode.MarkdownString();
  md.appendCodeblock(definitionText, "haproxy");
  md.appendMarkdown(`\n\n[Peek Definition](${commandUri(hc.document, site)})`);
  md.isTrusted = { enabledCommands: ["haproxy.peekDefinitionAtPosition"] };

  return new vscode.Hover(md, symbolRange(site));
}
