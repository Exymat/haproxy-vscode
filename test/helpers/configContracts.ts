import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Diagnostic } from "vscode";

import type { HaproxySchema } from "../../src/schema/types";
import { countDiagnosticsByCode, formatDiagnostics, type DiagnosticLike } from "./diagnosticCounts";
import { formatDiagnosticCode } from "./diagnosticFormat";
import { createDocument } from "./document";
import { runDiagnostics, schemas } from "./diagnostics";
import { readFixture, readGoldenFixture } from "./fixtures";
import type { SupportedVersion } from "./schema";

const integrationRoot = join(__dirname, "..", "integration", "fixtures");
const validUpstreamRoot = join(__dirname, "..", "fixtures", "valid-upstream");

export const ERROR_SEVERITY = 0;

export interface FixtureContractOptions {
  missingReferences?: boolean;
  unusedSymbols?: boolean;
  deprecatedWarnings?: boolean;
}

export interface ValidConfigContract {
  label: string;
  versions: SupportedVersion[];
  options?: FixtureContractOptions;
}

export interface LoadedFixtureContract {
  label: string;
  content: string;
  uri: string;
  version: SupportedVersion;
  schema: HaproxySchema;
  options: FixtureContractOptions;
}

function diagnosticCode(diag: DiagnosticLike): string {
  const code = diag.code;
  if (code === undefined) {
    return "unknown";
  }
  if (typeof code === "object" && code !== null && "value" in code) {
    return formatDiagnosticCode(code as { value: string | number });
  }
  return formatDiagnosticCode(code as string | number);
}

export function readIntegrationFixture(name: string): string {
  return readFileSync(join(integrationRoot, name), "utf-8");
}

export function readValidUpstreamFixture(name: string): string {
  return readFileSync(join(validUpstreamRoot, name), "utf-8");
}

export function loadFixtureContent(
  source: "fixtures" | "golden" | "integration" | "valid-upstream",
  path: string,
): string {
  switch (source) {
    case "golden":
      return readGoldenFixture(path);
    case "integration":
      return readIntegrationFixture(path);
    case "valid-upstream":
      return readValidUpstreamFixture(path);
    case "fixtures":
      return readFixture(path);
  }
}

export function loadFixtureContract(
  source: "fixtures" | "golden" | "integration" | "valid-upstream",
  path: string,
  version: SupportedVersion,
  options: FixtureContractOptions = {},
): LoadedFixtureContract {
  const content = loadFixtureContent(source, path);
  const uri = `file:///${source}/${path.replace(/\\/g, "/")}`;
  return {
    label: `${source}/${path}@${version}`,
    content,
    uri,
    version,
    schema: schemas[version],
    options,
  };
}

export function diagnosticsForContract(contract: LoadedFixtureContract): Diagnostic[] {
  const doc = createDocument(contract.content, contract.uri);
  return runDiagnostics(doc, contract.schema, contract.version, {
    missingReferences: contract.options.missingReferences ?? false,
    unusedSymbols: contract.options.unusedSymbols ?? false,
    deprecatedWarnings: contract.options.deprecatedWarnings ?? true,
  });
}

export function errorDiagnostics(diagnostics: DiagnosticLike[]): DiagnosticLike[] {
  return diagnostics.filter((diag) => Number(diag.severity) === ERROR_SEVERITY);
}

export function assertNoErrorDiagnostics(diagnostics: DiagnosticLike[], label = "config"): void {
  const errors = errorDiagnostics(diagnostics);
  if (errors.length > 0) {
    throw new Error(
      `${label}: expected no error-severity diagnostics, got ${errors.length}\n` +
        formatDiagnostics(errors),
    );
  }
}

export function assertDiagnosticCounts(
  diagnostics: DiagnosticLike[],
  expected: Record<string, number>,
  label: string,
): void {
  const counts = countDiagnosticsByCode(diagnostics);
  for (const [code, count] of Object.entries(expected)) {
    const actual = counts.get(code) ?? 0;
    if (actual !== count) {
      throw new Error(
        `${label}: expected ${count} '${code}' diagnostic(s), got ${actual}\n` +
          formatDiagnostics(diagnostics),
      );
    }
  }
}

export function diagnosticLinesForCodes(
  diagnostics: DiagnosticLike[],
  codes: Iterable<string>,
): Set<number> {
  const codeSet = new Set(codes);
  const lines = new Set<number>();
  for (const diag of diagnostics) {
    if (codeSet.has(diagnosticCode(diag)) && Number(diag.severity) === ERROR_SEVERITY) {
      lines.add(diag.range.start.line + 1);
    }
  }
  return lines;
}

export function assertDiagnosticLines(
  diagnostics: DiagnosticLike[],
  codes: Iterable<string>,
  expectedLines: Iterable<number>,
  label: string,
): void {
  const expected = new Set(expectedLines);
  const actual = diagnosticLinesForCodes(diagnostics, codes);
  const missing = [...expected].filter((line) => !actual.has(line));
  const extra = [...actual].filter((line) => !expected.has(line));
  if (missing.length > 0 || extra.length > 0) {
    const filtered = diagnostics.filter(
      (diag) =>
        new Set(codes).has(diagnosticCode(diag)) && Number(diag.severity) === ERROR_SEVERITY,
    );
    throw new Error(
      `${label}: diagnostic line mismatch: missing [${missing.join(", ")}], extra [${extra.join(", ")}]\n` +
        formatDiagnostics(filtered),
    );
  }
}

export function assertNoDiagnosticCode(
  diagnostics: DiagnosticLike[],
  code: string,
  label: string,
): void {
  const matches = diagnostics.filter((diag) => diagnosticCode(diag) === code);
  if (matches.length > 0) {
    throw new Error(
      `${label}: expected no '${code}' diagnostics, got ${matches.length}\n` +
        formatDiagnostics(matches),
    );
  }
}

export function runValidConfigContract(
  source: "fixtures" | "golden" | "integration" | "valid-upstream",
  path: string,
  version: SupportedVersion,
  options: FixtureContractOptions = {},
): void {
  const contract = loadFixtureContract(source, path, version, options);
  const diagnostics = diagnosticsForContract(contract);
  assertNoErrorDiagnostics(diagnostics, contract.label);
}
