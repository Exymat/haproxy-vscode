import * as vscode from "vscode";

import { DIAG_SOURCE } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import { buildSectionSymbols } from "./sectionOutline";
import { hasReferences, SymbolIndex, SymbolKind, SymbolSite } from "./symbolIndex";

export interface UnusedSymbolOptions {
  enabled: boolean;
  includeSections: boolean;
}

const SECTION_BLOCK_KINDS = new Set<SymbolKind>([
  "proxy-section",
  "defaults-profile",
  "cache",
  "userlist",
  "resolvers",
  "peers",
]);

const ENTRY_POINT_TOKENS = new Set(["bind", "bind-process"]);

function sectionBlockForSite(
  sectionByStartLine: Map<number, { startLine: number; endLine: number }>,
  site: SymbolSite,
  kind: SymbolKind,
): { startLine: number; endLine: number } {
  if (!SECTION_BLOCK_KINDS.has(kind)) {
    return { startLine: site.line, endLine: site.line };
  }

  const match = sectionByStartLine.get(site.line);
  if (match) {
    return match;
  }

  return { startLine: site.line, endLine: site.line };
}

function proxySectionType(parsed: ParsedLine[], defLine: number): string | null {
  const line = parsed[defLine];
  if (!line?.isSectionHeader || line.tokens.length === 0) {
    return null;
  }
  return line.tokens[0].text.toLowerCase();
}

function sectionBodyHasEntryPoint(
  parsed: ParsedLine[],
  startLine: number,
  endLine: number,
): boolean {
  for (let i = startLine + 1; i <= endLine; i += 1) {
    const line = parsed[i];
    for (const token of line.tokens) {
      if (ENTRY_POINT_TOKENS.has(token.text.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

function isExemptProxySection(
  parsed: ParsedLine[],
  site: SymbolSite,
  block: { startLine: number; endLine: number },
): boolean {
  const sectionType = proxySectionType(parsed, site.line);
  if (sectionType !== "frontend" && sectionType !== "listen") {
    return false;
  }
  return sectionBodyHasEntryPoint(parsed, block.startLine, block.endLine);
}

function unusedMessage(kind: SymbolKind, name: string, sectionType: string | null): string {
  switch (kind) {
    case "acl":
      return `ACL '${name}' is defined but never referenced in this section`;
    case "server":
      return `Server '${name}' is never referenced by use-server`;
    case "proxy-section":
      return `${sectionType ?? "Section"} '${name}' is never referenced by use_backend or default_backend`;
    case "defaults-profile":
      return `Defaults profile '${name}' is never referenced by 'from'`;
    case "cache":
      return `Cache '${name}' is never referenced`;
    case "userlist":
      return `Userlist '${name}' is never referenced`;
    case "resolvers":
      return `Resolvers '${name}' is never referenced`;
    case "peers":
      return `Peers section '${name}' is never referenced`;
    default:
      return `'${name}' appears unused`;
  }
}

function unusedCode(kind: SymbolKind): string {
  switch (kind) {
    case "acl":
      return "unused-acl";
    case "server":
      return "unused-server";
    case "proxy-section":
      return "unused-section";
    case "defaults-profile":
      return "unused-defaults-profile";
    default:
      return "unused-symbol";
  }
}

function makeUnusedDiagnostic(
  range: vscode.Range,
  message: string,
  code: string,
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Hint);
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = code;
  diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
  return diagnostic;
}

export function unusedSymbolDiagnostics(
  document: vscode.TextDocument,
  parsed: ParsedLine[],
  index: SymbolIndex,
  options: UnusedSymbolOptions,
): vscode.Diagnostic[] {
  if (!options.enabled) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const reported = new Set<string>();
  const sectionByStartLine = new Map<number, { startLine: number; endLine: number }>();
  for (const section of buildSectionSymbols(parsed, document.lineCount)) {
    sectionByStartLine.set(section.startLine, {
      startLine: section.startLine,
      endLine: section.endLine,
    });
  }

  for (const [key, defs] of index.definitions) {
    if (reported.has(key) || defs.length === 0) {
      continue;
    }
    reported.add(key);

    const site = defs[0];
    const { kind } = site;

    // Filter lines apply themselves; duplicate names are intentional filter types.
    if (kind === "filter") {
      continue;
    }

    if (SECTION_BLOCK_KINDS.has(kind) && !options.includeSections) {
      continue;
    }

    if (hasReferences(index, kind, site.name, site.scopeKey)) {
      continue;
    }

    const block = sectionBlockForSite(sectionByStartLine, site, kind);
    if (kind === "proxy-section" && isExemptProxySection(parsed, site, block)) {
      continue;
    }

    const sectionType = kind === "proxy-section" ? proxySectionType(parsed, site.line) : null;
    const message = unusedMessage(kind, site.name, sectionType);
    const code = unusedCode(kind);

    if (SECTION_BLOCK_KINDS.has(kind)) {
      const endLineText = document.lineAt(block.endLine).text;
      diagnostics.push(
        makeUnusedDiagnostic(
          new vscode.Range(block.startLine, 0, block.endLine, endLineText.length),
          message,
          code,
        ),
      );
      continue;
    }

    diagnostics.push(
      makeUnusedDiagnostic(
        new vscode.Range(site.line, site.start, site.line, site.end),
        message,
        code,
      ),
    );
  }

  return diagnostics;
}
