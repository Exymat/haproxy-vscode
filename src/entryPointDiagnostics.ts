import * as vscode from "vscode";

import { DIAG_SOURCE } from "./diagnosticUtils";
import { DiagnosticContext } from "./diagnosticContext";
import { ParsedLine } from "./parser";
import { getSectionOutline } from "./sectionOutline";

interface SectionBlock {
  kind: string;
  name: string | null;
  fromDefaults: string | null;
  headerLine: number;
  startLine: number;
  endLine: number;
}

function parseSectionHeader(
  line: ParsedLine,
): Omit<SectionBlock, "headerLine" | "startLine" | "endLine"> | null {
  if (!line.isSectionHeader || line.tokens.length === 0) {
    return null;
  }
  const kind = line.tokens[0].text.toLowerCase();
  let name: string | null = null;
  let fromDefaults: string | null = null;
  if (line.tokens[1] && line.tokens[1].text.toLowerCase() !== "from") {
    name = line.tokens[1].text;
  }
  for (let i = 1; i < line.tokens.length - 1; i += 1) {
    if (line.tokens[i].text.toLowerCase() === "from") {
      fromDefaults = line.tokens[i + 1].text;
      break;
    }
  }
  return { kind, name, fromDefaults };
}

function buildSectionBlocks(parsed: ParsedLine[]): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  for (const line of parsed) {
    if (!line.isSectionHeader) {
      continue;
    }
    const header = parseSectionHeader(line);
    if (!header) {
      continue;
    }
    blocks.push({
      ...header,
      headerLine: line.line,
      startLine: line.line,
      endLine: line.line,
    });
  }
  for (let i = 0; i < blocks.length - 1; i += 1) {
    blocks[i].endLine = blocks[i + 1].startLine - 1;
  }
  if (blocks.length > 0) {
    blocks[blocks.length - 1].endLine = parsed.length - 1;
  }
  return blocks;
}

function lineHasBindToken(line: ParsedLine | undefined, bindTokens: Set<string>): boolean {
  if (!line) {
    return false;
  }
  for (const token of line.tokens) {
    if (bindTokens.has(token.text.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function blockBodyHasBind(
  parsed: ParsedLine[],
  startLine: number,
  endLine: number,
  bindTokens: Set<string>,
): boolean {
  for (let i = startLine + 1; i <= endLine; i += 1) {
    if (lineHasBindToken(parsed[i], bindTokens)) {
      return true;
    }
  }
  return false;
}

function findNamedDefaultsBefore(blocks: SectionBlock[], idx: number, name: string): number {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (blocks[i].kind === "defaults" && blocks[i].name === name) {
      return i;
    }
  }
  return -1;
}

function findPreviousDefaults(blocks: SectionBlock[], idx: number): number {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (blocks[i].kind === "defaults") {
      return i;
    }
  }
  return -1;
}

function sectionHasBind(
  parsed: ParsedLine[],
  blocks: SectionBlock[],
  idx: number,
  memo: Map<number, boolean>,
  resolving: Set<number>,
  bindTokens: Set<string>,
): boolean {
  const cached = memo.get(idx);
  if (cached !== undefined) {
    return cached;
  }
  if (resolving.has(idx)) {
    return false;
  }
  resolving.add(idx);

  const block = blocks[idx];
  let hasBind = blockBodyHasBind(parsed, block.startLine, block.endLine, bindTokens);
  if (!hasBind) {
    let parent = -1;
    if (block.fromDefaults) {
      parent = findNamedDefaultsBefore(blocks, idx, block.fromDefaults);
    } else if (block.kind !== "defaults") {
      parent = findPreviousDefaults(blocks, idx);
    }
    if (parent >= 0) {
      hasBind = sectionHasBind(parsed, blocks, parent, memo, resolving, bindTokens);
    }
  }

  resolving.delete(idx);
  memo.set(idx, hasBind);
  return hasBind;
}

function entryPointLabel(kind: string): string {
  return kind === "listen" ? "Listen" : "Frontend";
}

function makeNoBindWarning(
  document: vscode.TextDocument,
  headerLine: number,
  kind: string,
  name: string | null,
): vscode.Diagnostic {
  const sectionName = name ?? kind;
  const lineText = document.lineAt(headerLine).text;
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(headerLine, 0, headerLine, lineText.length),
    `${entryPointLabel(kind)} '${sectionName}' has no bind directive and cannot accept connections`,
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = "no-bind-entry-point";
  return diagnostic;
}

interface EntryPointDiagCacheEntry {
  version: number;
  outlineVersion: number;
  diagnostics: vscode.Diagnostic[];
}

const entryPointDiagCache = new WeakMap<vscode.TextDocument, EntryPointDiagCacheEntry>();

function computeEntryPointDiagnostics(
  document: vscode.TextDocument,
  parsed: ParsedLine[],
  ctx: Pick<DiagnosticContext, "entryPointSections" | "bindDetectKeywords">,
): vscode.Diagnostic[] {
  getSectionOutline(document, parsed);
  const blocks = buildSectionBlocks(parsed);
  if (blocks.length === 0) {
    return [];
  }

  const memo = new Map<number, boolean>();
  const resolving = new Set<number>();
  const diagnostics: vscode.Diagnostic[] = [];

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!ctx.entryPointSections.has(block.kind)) {
      continue;
    }
    if (sectionHasBind(parsed, blocks, i, memo, resolving, ctx.bindDetectKeywords)) {
      continue;
    }
    diagnostics.push(makeNoBindWarning(document, block.headerLine, block.kind, block.name));
  }

  return diagnostics;
}

export function entryPointWithoutBindDiagnostics(
  document: vscode.TextDocument,
  parsed: ParsedLine[],
  ctx: Pick<DiagnosticContext, "entryPointSections" | "bindDetectKeywords">,
): vscode.Diagnostic[] {
  const hit = entryPointDiagCache.get(document);
  if (hit && hit.version === document.version) {
    return hit.diagnostics;
  }

  const diagnostics = computeEntryPointDiagnostics(document, parsed, ctx);
  entryPointDiagCache.set(document, {
    version: document.version,
    outlineVersion: document.version,
    diagnostics,
  });
  return diagnostics;
}

/** @internal Exported for tests that need section block construction. */
export { buildSectionBlocks, sectionHasBind };
