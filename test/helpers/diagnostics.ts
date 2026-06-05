import { computeDiagnostics } from "../../src/diagnostics";
import type { HaproxySchema } from "../../src/schema";
import { createDocument, type MockTextDocument } from "./document";
import { loadAllLanguageData, loadAllSchemas, type SupportedVersion } from "./schema";

export const DEFAULT_VERSION: SupportedVersion = "3.2";

const schemas = loadAllSchemas();
const languageDataByVersion = loadAllLanguageData();
const defaultSchema = schemas[DEFAULT_VERSION];

export interface DiagnosticExpectations {
  total?: number;
  counts?: Record<string, number>;
  severity?: number;
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
  return computeDiagnostics(doc as never, schemaForCase, diagnosticOptions(version, overrides));
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
  const byCode = new Map<string, number>();
  for (const diag of diagnostics) {
    const code = diag.code ?? "unknown";
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }

  for (const [code, count] of Object.entries(expectations.counts ?? {})) {
    const actual = byCode.get(code) ?? 0;
    if (actual !== count) {
      throw new Error(
        `${name}: expected ${count} '${code}' diagnostic(s), got ${actual}\n` +
          diagnostics
            .map((d) => `  L${d.range.start.line + 1}: [${d.code}] ${d.message}`)
            .join("\n"),
      );
    }
  }

  const expectedTotal =
    expectations.total ?? Object.values(expectations.counts ?? {}).reduce((a, b) => a + b, 0);
  if (diagnostics.length !== expectedTotal) {
    throw new Error(
      `${name}: expected ${expectedTotal} total diagnostic(s), got ${diagnostics.length}\n` +
        diagnostics.map((d) => `  L${d.range.start.line + 1}: [${d.code}] ${d.message}`).join("\n"),
    );
  }

  if (expectations.severity !== undefined) {
    for (const diag of diagnostics) {
      if (diag.severity !== expectations.severity) {
        throw new Error(
          `${name}: expected severity ${expectations.severity}, got ${diag.severity} for ${diag.message}`,
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

export { defaultSchema, languageDataByVersion, schemas };
