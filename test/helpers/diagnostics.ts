import { computeDiagnostics } from "../../src/diagnostics";
import type { HaproxySchema } from "../../src/schema";
import { formatDiagnosticCode } from "./diagnosticFormat";
import { createDocument, type MockTextDocument } from "./document";
import { loadAllLanguageData, loadAllSchemas, type SupportedVersion } from "./schema";

export const DEFAULT_VERSION: SupportedVersion = "3.4";

const schemas = loadAllSchemas();
const languageDataByVersion = loadAllLanguageData();
const defaultSchema = schemas[DEFAULT_VERSION];

export interface DiagnosticExpectations {
  total?: number;
  counts?: Record<string, number>;
  severity?: number;
}

interface DiagnosticLike {
  code?: unknown;
  message: string;
  range: {
    start: {
      line: number;
    };
  };
  severity?: number;
}

function diagnosticCodeText(
  code: unknown,
): string | number | { value: string | number; target: unknown } | undefined {
  if (
    code === undefined ||
    typeof code === "string" ||
    typeof code === "number" ||
    (typeof code === "object" &&
      code !== null &&
      "value" in code &&
      (typeof (code as { value?: unknown }).value === "string" ||
        typeof (code as { value?: unknown }).value === "number"))
  ) {
    return code as string | number | { value: string | number; target: unknown } | undefined;
  }
  return JSON.stringify(code);
}

export function diagnosticOptions(
  version: SupportedVersion = DEFAULT_VERSION,
  overrides: Record<string, unknown> = {},
) {
  return {
    languageData: languageDataByVersion[version],
    deprecatedWarnings: true,
    ...overrides,
  };
}

export function runDiagnostics(
  doc: MockTextDocument,
  schemaForCase: HaproxySchema,
  version: SupportedVersion = DEFAULT_VERSION,
  overrides: Record<string, unknown> = {},
) {
  return computeDiagnostics(doc, schemaForCase, diagnosticOptions(version, overrides));
}

export function runDiagnosticCase(
  name: string,
  content: string,
  expectations: DiagnosticExpectations,
  schemaForCase: HaproxySchema = defaultSchema,
  version: SupportedVersion = DEFAULT_VERSION,
): void {
  const doc = createDocument(content);
  const diagnostics = runDiagnostics(doc, schemaForCase, version);
  const byCode = countDiagnosticsByCode(diagnostics);

  for (const [code, count] of Object.entries(expectations.counts ?? {})) {
    const actual = byCode.get(code) ?? 0;
    if (actual !== count) {
      throw new Error(
        `${name}: expected ${count} '${code}' diagnostic(s), got ${actual}\n` +
          formatDiagnostics(diagnostics),
      );
    }
  }

  const expectedTotal =
    expectations.total ?? Object.values(expectations.counts ?? {}).reduce((a, b) => a + b, 0);
  if (diagnostics.length !== expectedTotal) {
    throw new Error(
      `${name}: expected ${expectedTotal} total diagnostic(s), got ${diagnostics.length}\n` +
        formatDiagnostics(diagnostics),
    );
  }

  if (expectations.severity !== undefined) {
    for (const diag of diagnostics) {
      if (Number(diag.severity) !== expectations.severity) {
        throw new Error(
          `${name}: expected severity ${expectations.severity}, got ${Number(diag.severity)} for ${diag.message}`,
        );
      }
    }
  }
}

export function expectNoDiagnosticCode(
  content: string,
  name: string,
  code: string,
  schemaForCase: HaproxySchema = defaultSchema,
  version: SupportedVersion = DEFAULT_VERSION,
): void {
  const doc = createDocument(content);
  const diags = runDiagnostics(doc, schemaForCase, version).filter((d) => d.code === code);
  if (diags.length > 0) {
    throw new Error(
      `${name}: expected no '${code}' diagnostics, got ${diags.length}\n` +
        diags.map((d) => `  L${d.range.start.line + 1}: ${d.message}`).join("\n"),
    );
  }
}

export function countDiagnosticsByCode(diags: DiagnosticLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diag of diags) {
    const code = formatDiagnosticCode(diagnosticCodeText(diag.code));
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

export function formatDiagnostics(diags: DiagnosticLike[]): string {
  return diags
    .map(
      (d) =>
        `  L${d.range.start.line + 1}: [${formatDiagnosticCode(diagnosticCodeText(d.code))}] ${d.message}`,
    )
    .join("\n");
}

export function assertDiagnosticCounts(
  diags: DiagnosticLike[],
  expected: Record<string, number>,
  label: string,
): void {
  const counts = countDiagnosticsByCode(diags);
  for (const [code, count] of Object.entries(expected)) {
    const actual = counts.get(code) ?? 0;
    if (actual !== count) {
      throw new Error(
        `${label}: expected ${count} '${code}' diagnostic(s), got ${actual}\n${formatDiagnostics(diags)}`,
      );
    }
  }
}

export { defaultSchema, languageDataByVersion, schemas };
