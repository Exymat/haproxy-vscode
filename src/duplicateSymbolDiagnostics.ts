import * as vscode from "vscode";

import { makeDiagnostic } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import type { SymbolKind } from "./symbolIndex/types";
import type { WorkspaceSymbolIndex, WorkspaceSymbolSite } from "./symbolIndex/workspace";

const DUPLICATE_SECTION_KINDS = new Set<SymbolKind>([
  "proxy-section",
  "defaults-profile",
  "cache",
  "userlist",
  "resolvers",
  "peers",
]);

function siteRange(site: WorkspaceSymbolSite): vscode.Range {
  return new vscode.Range(site.line, site.start, site.line, site.end);
}

function currentUriKey(document: vscode.TextDocument): string {
  return document.uri.toString();
}

function sectionLabel(parsed: ParsedLine[], site: WorkspaceSymbolSite): string {
  const header = parsed[site.line];
  const keyword = header?.tokens[0]?.text.toLowerCase();
  switch (site.kind) {
    case "proxy-section":
      return keyword ? `${keyword} section` : "proxy section";
    case "defaults-profile":
      return "defaults profile";
    case "cache":
      return "cache section";
    case "userlist":
      return "userlist section";
    case "resolvers":
      return "resolvers section";
    case "peers":
      return "peers section";
    /* v8 ignore next -- duplicate section diagnostics are filtered to known section kinds. */
    default:
      return "section";
  }
}

function definitionLocationSummary(definitions: WorkspaceSymbolSite[], currentKey: string): string {
  const otherFileCount = new Set(
    definitions.filter((site) => site.uriKey !== currentKey).map((site) => site.uriKey),
  ).size;

  if (otherFileCount === 0) {
    return "in this file";
  }
  if (otherFileCount === 1) {
    return "in another workspace file";
  }
  return `in ${otherFileCount} other workspace files`;
}

export function duplicateSectionDiagnostics(
  document: vscode.TextDocument,
  parsed: ParsedLine[],
  workspaceIndex: WorkspaceSymbolIndex | null,
): vscode.Diagnostic[] {
  const documentKey = currentUriKey(document);
  if (!workspaceIndex || !workspaceIndex.documents.has(documentKey)) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const reported = new Set<string>();

  for (const definitions of workspaceIndex.definitions.values()) {
    if (definitions.length < 2 || !DUPLICATE_SECTION_KINDS.has(definitions[0].kind)) {
      continue;
    }

    const currentDefinitions = definitions.filter((site) => site.uriKey === documentKey);
    for (const site of currentDefinitions) {
      const key = [site.kind, site.name.toLowerCase(), site.line, site.start, site.end].join("\0");
      if (reported.has(key)) {
        continue;
      }
      reported.add(key);

      const label = sectionLabel(parsed, site);
      const locationSummary = definitionLocationSummary(definitions, documentKey);
      diagnostics.push(
        makeDiagnostic(
          siteRange(site),
          `Duplicate ${label} '${site.name}' is also defined ${locationSummary}`,
          vscode.DiagnosticSeverity.Warning,
          "duplicate-section",
        ),
      );
    }
  }

  return diagnostics;
}
