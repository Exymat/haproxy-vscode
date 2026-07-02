import * as vscode from "vscode";

import { DIAG_SOURCE } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import { getSectionOutline, SectionSymbolInfo } from "./sectionOutline";
import { hasReferences, SymbolIndex, SymbolKind, SymbolSite } from "./symbolIndex";

export interface UnusedSymbolOptions {
  enabled: boolean;
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

const SKIPPED_UNUSED_KINDS = new Set<SymbolKind>(["filter", "server"]);

function sectionOutlineByStartLine(
  document: vscode.TextDocument,
  parsed: ParsedLine[],
): Map<number, SectionSymbolInfo> {
  const byStartLine = new Map<number, SectionSymbolInfo>();
  for (const section of getSectionOutline(document, parsed)) {
    byStartLine.set(section.startLine, section);
  }
  return byStartLine;
}

function sectionBlockBounds(
  outline: SectionSymbolInfo | undefined,
  site: SymbolSite,
  kind: SymbolKind,
): { startLine: number; endLine: number } {
  if (outline) {
    return { startLine: outline.startLine, endLine: outline.endLine };
  }
  if (SECTION_BLOCK_KINDS.has(kind)) {
    return { startLine: site.line, endLine: site.line };
  }
  return { startLine: site.line, endLine: site.line };
}

function sectionHeaderRange(
  site: SymbolSite,
  outline: SectionSymbolInfo | undefined,
): vscode.Range {
  if (outline) {
    return new vscode.Range(
      outline.startLine,
      outline.selectionStart,
      outline.startLine,
      outline.selectionEnd,
    );
  }
  return new vscode.Range(site.line, site.start, site.line, site.end);
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
    case "proxy-section":
      return "unused-section";
    case "defaults-profile":
      return "unused-defaults-profile";
    default:
      return "unused-symbol";
  }
}

/** Information severity: full-line squiggle on unused ACL and similar symbols. */
function makeUnusedLineDiagnostic(
  range: vscode.Range,
  message: string,
  code: string,
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Information);
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = code;
  diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
  return diagnostic;
}

/** Information severity: squiggle on the section header keyword only. */
function makeUnusedSectionDiagnostic(
  range: vscode.Range,
  message: string,
  code: string,
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Information);
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = code;
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
  const outlineByStartLine = sectionOutlineByStartLine(document, parsed);

  for (const [key, defs] of index.definitions) {
    if (reported.has(key) || defs.length === 0) {
      continue;
    }
    reported.add(key);

    const site = defs[0];
    const { kind } = site;

    if (SKIPPED_UNUSED_KINDS.has(kind)) {
      continue;
    }

    if (hasReferences(index, kind, site.name, site.scopeKey)) {
      continue;
    }

    const outline = outlineByStartLine.get(site.line);
    const block = sectionBlockBounds(outline, site, kind);
    if (kind === "proxy-section" && isExemptProxySection(parsed, site, block)) {
      continue;
    }

    const sectionType = kind === "proxy-section" ? proxySectionType(parsed, site.line) : null;
    const message = unusedMessage(kind, site.name, sectionType);
    const code = unusedCode(kind);

    if (SECTION_BLOCK_KINDS.has(kind)) {
      diagnostics.push(
        makeUnusedSectionDiagnostic(sectionHeaderRange(site, outline), message, code),
      );
      continue;
    }

    const lineText = document.lineAt(site.line).text;
    diagnostics.push(
      makeUnusedLineDiagnostic(
        new vscode.Range(site.line, 0, site.line, lineText.length),
        message,
        code,
      ),
    );
  }

  return diagnostics;
}
