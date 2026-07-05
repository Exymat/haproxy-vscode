import * as vscode from "vscode";

import { makeDiagnostic } from "./diagnosticUtils";
import { SymbolIndex, SymbolKind, SymbolSite } from "./symbolIndex";

function siteRange(site: SymbolSite): vscode.Range {
  return new vscode.Range(site.line, site.start, site.line, site.end);
}

function symbolLabel(kind: SymbolKind): string {
  switch (kind) {
    case "proxy-section":
      return "Proxy section";
    case "defaults-profile":
      return "Defaults profile";
    case "userlist":
      return "Userlist";
    default:
      return kind.slice(0, 1).toUpperCase() + kind.slice(1);
  }
}

function siteKey(site: SymbolSite): string {
  return [
    site.kind,
    site.name.toLowerCase(),
    site.scopeKey ?? "",
    site.line,
    site.start,
    site.end,
  ].join("\0");
}

export function missingReferenceDiagnostics(index: SymbolIndex): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const reported = new Set<string>();

  for (const reference of index.unresolvedReferences) {
    const key = siteKey(reference);
    if (reported.has(key)) {
      continue;
    }
    reported.add(key);
    diagnostics.push(
      makeDiagnostic(
        siteRange(reference),
        `${symbolLabel(reference.kind)} '${reference.name}' is referenced but not defined in this file`,
        vscode.DiagnosticSeverity.Warning,
        "missing-reference",
      ),
    );
  }

  return diagnostics;
}
