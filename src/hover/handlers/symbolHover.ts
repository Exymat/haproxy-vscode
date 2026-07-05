import * as vscode from "vscode";

import {
  findDefinitions,
  findReferences,
  findSiteAtPosition,
  getSymbolIndex,
  SymbolSite,
} from "../../symbolIndex";
import { escapeMarkdownText } from "../markdown";
import { HoverContext } from "../types";

function symbolRange(site: SymbolSite): vscode.Range {
  return new vscode.Range(site.line, site.start, site.line, site.end);
}

function symbolLabel(kind: string): string {
  return kind
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function commandUri(document: vscode.TextDocument, site: SymbolSite): string {
  const args = encodeURIComponent(JSON.stringify([document.uri.toString(), site.line, site.start]));
  return `command:haproxy.peekDefinitionAtPosition?${args}`;
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
  const references = findReferences(index, site.kind, site.name, site.scopeKey);
  const title = `${symbolLabel(site.kind)} '${escapeMarkdownText(site.name)}'`;
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${title}**`);

  const definition = definitions[0];
  if (definition) {
    md.appendMarkdown(`\n\nDefined on line ${definition.line + 1}.`);
  } else {
    md.appendMarkdown("\n\nNo definition found in this file.");
  }

  md.appendMarkdown(`\n\nReferences: ${references.length}`);
  if (definition) {
    md.appendMarkdown(`\n\n[Peek Definition](${commandUri(hc.document, site)})`);
    md.isTrusted = { enabledCommands: ["haproxy.peekDefinitionAtPosition"] };
  }

  return new vscode.Hover(md, symbolRange(site));
}
