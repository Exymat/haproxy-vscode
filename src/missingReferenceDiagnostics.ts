import * as vscode from "vscode";

import { makeDiagnostic } from "./diagnosticUtils";
import { HaproxySchema } from "./schema/types";
import { symbolStringMap } from "./schema/symbols";
import { SymbolIndex, SymbolKind, SymbolSite } from "./symbolIndex";

function siteRange(site: SymbolSite): vscode.Range {
  return new vscode.Range(site.line, site.start, site.line, site.end);
}

function symbolLabel(schema: HaproxySchema, kind: SymbolKind): string {
  const labels = symbolStringMap(schema, "symbol_kind_labels");
  if (labels[kind]) {
    return labels[kind];
  }
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
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

export interface MissingReferenceDiagnosticsOptions {
  scope?: "file" | "workspace";
}

export function missingReferenceDiagnostics(
  index: SymbolIndex,
  schema: HaproxySchema,
  options?: MissingReferenceDiagnosticsOptions,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const reported = new Set<string>();
  const scopeLabel = options?.scope === "workspace" ? "in this workspace" : "in this file";

  for (const reference of index.unresolvedReferences) {
    if (reference.kind === "environment-variable") {
      continue;
    }
    const key = siteKey(reference);
    if (reported.has(key)) {
      continue;
    }
    reported.add(key);
    diagnostics.push(
      makeDiagnostic(
        siteRange(reference),
        `${symbolLabel(schema, reference.kind)} '${reference.name}' is referenced but not defined ${scopeLabel}`,
        vscode.DiagnosticSeverity.Warning,
        "missing-reference",
      ),
    );
  }

  return diagnostics;
}
