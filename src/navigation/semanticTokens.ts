/** Semantic highlighting derived from parsed symbol definitions and references. */
import * as vscode from "vscode";

import { HaproxySchema } from "../schema/types";
import { getSymbolIndex } from "../symbolIndex";

export const BACKEND_REFERENCE_TOKEN_TYPE = "backendReference";

export const backendReferenceLegend = new vscode.SemanticTokensLegend([
  BACKEND_REFERENCE_TOKEN_TYPE, "type", "property", "variable",
], ["declaration"]);

const BACKEND_REFERENCE_KEYWORDS = new Set(["use_backend", "default_backend"]);

function isBackendReferenceLine(lineText: string): boolean {
  const trimmed = lineText.trimStart().toLowerCase();
  for (const keyword of BACKEND_REFERENCE_KEYWORDS) {
    if (trimmed.startsWith(`${keyword} `) || trimmed === keyword) {
      return true;
    }
  }
  return false;
}

export function provideSemanticTokens(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
): vscode.SemanticTokens {
  const builder = new vscode.SemanticTokensBuilder(backendReferenceLegend);
  if (document.lineCount > maxLines) {
    return builder.build();
  }

  const index = getSymbolIndex(document, schema, maxLines);
  if (!index) {
    return builder.build();
  }

  const sites = [...index.definitions.values()].flat().concat(index.references);
  sites.sort((a, b) => a.line - b.line || a.start - b.start);
  let previousLine = -1;
  let previousEnd = -1;
  for (const site of sites) {
    if (site.end <= site.start || (site.line === previousLine && site.start < previousEnd)) continue;
    let tokenType: number;
    if (site.kind === "proxy-section") {
      if (site.role === "reference" && !isBackendReferenceLine(document.lineAt(site.line).text)) continue;
      tokenType = site.role === "reference" ? 0 : 1;
    } else if (site.kind === "acl" || site.kind === "server" || site.kind === "server-template") {
      tokenType = 2;
    } else if (site.kind === "variable" || site.kind === "environment-variable") {
      tokenType = 3;
    } else continue;
    builder.push(site.line, site.start, site.end - site.start, tokenType, site.role === "definition" ? 1 : 0);
    previousLine = site.line;
    previousEnd = site.end;
  }

  return builder.build();
}
