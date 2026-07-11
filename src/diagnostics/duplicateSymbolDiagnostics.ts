import * as vscode from "vscode";

import { makeDiagnostic } from "./diagnosticUtils";
import { ParsedLine } from "../parser";
import { HaproxySchema } from "../schema/types";
import { symbolStringList, symbolStringMap } from "../schema/symbols";
import type { SymbolKind } from "../symbolIndex/types";
import {
  workspaceUriKey,
  type WorkspaceSymbolIndex,
  type WorkspaceSymbolSite,
} from "../symbolIndex/workspace";

function duplicateSectionKinds(schema: HaproxySchema): Set<SymbolKind> {
  return new Set(symbolStringList(schema, "duplicate_section_kinds"));
}

function duplicateSectionLabels(schema: HaproxySchema): Record<string, string> {
  return symbolStringMap(schema, "symbol_kind_labels");
}

function siteRange(site: WorkspaceSymbolSite): vscode.Range {
  return new vscode.Range(site.line, site.start, site.line, site.end);
}

function currentUriKey(document: vscode.TextDocument): string {
  return workspaceUriKey(document.uri);
}

function sectionLabel(
  schema: HaproxySchema,
  parsed: ParsedLine[],
  site: WorkspaceSymbolSite,
): string {
  const header = parsed[site.line];
  const keyword = header?.tokens[0]?.text.toLowerCase();
  if (site.kind === "proxy-section") {
    return keyword ? `${keyword} section` : "proxy section";
  }
  return duplicateSectionLabels(schema)[site.kind] ?? site.kind;
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
  schema: HaproxySchema,
): vscode.Diagnostic[] {
  const documentKey = currentUriKey(document);
  if (!workspaceIndex || !workspaceIndex.documents.has(documentKey)) {
    return [];
  }

  const duplicateKinds = duplicateSectionKinds(schema);
  const diagnostics: vscode.Diagnostic[] = [];
  const reported = new Set<string>();

  for (const definitions of workspaceIndex.definitions.values()) {
    if (definitions.length < 2 || !duplicateKinds.has(definitions[0].kind)) {
      continue;
    }

    const currentDefinitions = definitions.filter((site) => site.uriKey === documentKey);
    for (const site of currentDefinitions) {
      const key = [site.kind, site.name.toLowerCase(), site.line, site.start, site.end].join("\0");
      if (reported.has(key)) {
        continue;
      }
      reported.add(key);

      const label = sectionLabel(schema, parsed, site);
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
