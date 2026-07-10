import * as vscode from "vscode";

import { DIAG_SOURCE } from "./diagnosticUtils";
import { DiagnosticContext } from "./diagnosticContext";
import { ParsedLine } from "./parser";
import { getSectionOutline, SectionSymbolInfo } from "./sectionOutline";
import { hasReferences, SymbolIndex, SymbolKind, SymbolSite } from "./symbolIndex";
import { HaproxySchema } from "./schema/types";
import { symbolStringList } from "./schema/symbols";
import { validationStringMap } from "./schema/validation";

export interface UnusedSymbolOptions {
  enabled: boolean;
}

function unusedSymbolSectionBlockKinds(schema: HaproxySchema): Set<SymbolKind> {
  return new Set(symbolStringList(schema, "unused_symbol_section_block_kinds"));
}

function skippedUnusedSymbolKinds(schema: HaproxySchema): Set<SymbolKind> {
  return new Set(symbolStringList(schema, "unused_symbol_skipped_kinds"));
}

function conventionalDefaultsProfileNames(schema: HaproxySchema): Set<string> {
  return new Set(
    symbolStringList(schema, "conventional_defaults_profile_names").map((name) =>
      name.toLowerCase(),
    ),
  );
}

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
): { startLine: number; endLine: number } {
  if (outline) {
    return { startLine: outline.startLine, endLine: outline.endLine };
  }
  return { startLine: site.line, endLine: site.line };
}

function sectionBlockRange(
  outline: SectionSymbolInfo | undefined,
  site: SymbolSite,
  kind: SymbolKind,
  document: vscode.TextDocument,
): vscode.Range {
  const block = sectionBlockBounds(outline, site);
  const endColumn =
    outline && outline.endLine === block.endLine
      ? outline.endColumn
      : document.lineAt(block.endLine).text.length;
  return new vscode.Range(block.startLine, 0, block.endLine, endColumn);
}

function proxySectionType(parsed: ParsedLine[], defLine: number): string | null {
  const line = parsed[defLine];
  if (!line?.isSectionHeader || line.tokens.length === 0) {
    return null;
  }
  return line.tokens[0].text.toLowerCase();
}

function isEntryPointProxySection(
  parsed: ParsedLine[],
  defLine: number,
  entryPointSections: Set<string>,
): boolean {
  const sectionType = proxySectionType(parsed, defLine);
  return sectionType !== null && entryPointSections.has(sectionType);
}

function isConventionalDefaultProfile(schema: HaproxySchema, site: SymbolSite): boolean {
  return (
    site.kind === "defaults-profile" &&
    conventionalDefaultsProfileNames(schema).has(site.name.toLowerCase())
  );
}

function unusedMessage(schema: HaproxySchema, kind: SymbolKind, name: string): string {
  const messages = validationStringMap(schema, "unused_symbol_messages");
  const template = messages[kind] ?? messages.default ?? "'{name}' appears unused";
  return template.replaceAll("{name}", name);
}

function unusedCode(schema: HaproxySchema, kind: SymbolKind): string {
  return validationStringMap(schema, "unused_symbol_codes")[kind] ?? "unused-symbol";
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

export function unusedSymbolDiagnostics(
  document: vscode.TextDocument,
  parsed: ParsedLine[],
  index: SymbolIndex,
  ctx: Pick<DiagnosticContext, "entryPointSections" | "schema">,
  options: UnusedSymbolOptions,
): vscode.Diagnostic[] {
  if (!options.enabled) {
    return [];
  }

  const sectionBlockKinds = unusedSymbolSectionBlockKinds(ctx.schema);
  const skippedKinds = skippedUnusedSymbolKinds(ctx.schema);
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

    if (skippedKinds.has(kind)) {
      continue;
    }

    if (
      kind === "proxy-section" &&
      isEntryPointProxySection(parsed, site.line, ctx.entryPointSections)
    ) {
      continue;
    }

    if (isConventionalDefaultProfile(ctx.schema, site)) {
      continue;
    }

    if (hasReferences(index, kind, site.name, site.scopeKey)) {
      continue;
    }

    const outline = outlineByStartLine.get(site.line);
    const message = unusedMessage(ctx.schema, kind, site.name);
    const code = unusedCode(ctx.schema, kind);

    if (sectionBlockKinds.has(kind)) {
      diagnostics.push(
        makeUnusedLineDiagnostic(sectionBlockRange(outline, site, kind, document), message, code),
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
