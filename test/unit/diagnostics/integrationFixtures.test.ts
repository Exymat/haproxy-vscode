import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeDiagnostics } from "../../../src/diagnostics";
import { countDiagnosticsByCode, diagnosticOptions, schemas } from "../../helpers/diagnostics";
import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import { createDocument } from "../../helpers/document";

const fixturesDir = join(__dirname, "..", "..", "integration", "fixtures");

function readIntegrationFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

function diagnosticsForFixture(
  name: string,
  version: keyof typeof schemas = "3.2",
  overrides: Record<string, unknown> = {},
) {
  const doc = createDocument(readIntegrationFixture(name), `file:///integration/${name}`);
  return computeDiagnostics(doc, schemas[version], diagnosticOptions(version, overrides));
}

function expectCounts(
  diagnostics: ReturnType<typeof diagnosticsForFixture>,
  expected: Record<string, number>,
): void {
  const counts = countDiagnosticsByCode(diagnostics);
  expect(Object.fromEntries(counts.entries())).toMatchObject(expected);
  for (const [code, count] of Object.entries(expected)) {
    expect(counts.get(code) ?? 0).toBe(count);
  }
}

describe("promoted integration diagnostic fixtures", () => {
  it.each([
    ["unknown-option.cfg", { "unknown-option": 1 }],
    ["wrong-section.cfg", { "wrong-section": 1 }],
    ["wrong-context.cfg", { "wrong-context": 1 }],
    [
      "listen-invalid.cfg",
      {
        "unknown-value": 1,
        "unknown-keyword": 1,
        "unknown-criterion": 1,
        "unknown-action": 1,
      },
    ],
    [
      "diagnostics-matrix.cfg",
      {
        "unknown-option": 1,
        "unknown-value": 1,
        "unknown-keyword": 1,
        "unknown-criterion": 1,
        "unknown-action": 1,
        "wrong-section": 1,
      },
    ],
    [
      "name-address-diagnostics.cfg",
      {
        "invalid-name": 2,
        "extra-argument": 2,
        "invalid-address": 1,
        "missing-port": 1,
        "port-range-not-permitted": 1,
        "port-offset-not-permitted": 1,
      },
    ],
  ] as const)("%s", (fixture, expected) => {
    expect.hasAssertions();
    expectCounts(diagnosticsForFixture(fixture), expected);
  });

  it("reports sample expression fetch and converter errors", () => {
    const diagnostics = diagnosticsForFixture("sample-expression-errors.cfg");
    const counts = countDiagnosticsByCode(diagnostics);
    for (const code of [
      "sample-missing-fetch",
      "sample-unknown-fetch",
      "sample-fetch-args",
      "sample-unknown-converter",
      "sample-converter-cast",
      "sample-converter-args",
    ]) {
      expect(counts.get(code) ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not flag dynamic backend expressions as missing references", () => {
    const diagnostics = diagnosticsForFixture("dynamic-backends.cfg", "3.2", {
      missingReferences: true,
      unusedSymbols: true,
    });
    expect(
      diagnostics.some((diag) => formatDiagnosticCode(diag.code) === "missing-reference"),
    ).toBe(false);
  });

  it("keeps the valid basic-check fixture free of errors", () => {
    const diagnostics = diagnosticsForFixture("valid-basic-check.cfg", "3.2", {
      missingReferences: true,
      unusedSymbols: true,
    });
    expect(diagnostics.filter((diag) => Number(diag.severity) === 0)).toEqual([]);
  });

  it("reports anonymous named-defaults-only keywords on 3.4", () => {
    expect.hasAssertions();
    expectCounts(diagnosticsForFixture("named-defaults-required.cfg", "3.4"), {
      "named-defaults-required": 2,
    });
  });

  it("honors deprecated warning controls", () => {
    expectCounts(diagnosticsForFixture("deprecated-master-worker.cfg", "3.4"), {
      "deprecated-keyword": 1,
    });
    expect(diagnosticsForFixture("deprecated-suppressed.cfg", "3.4")).toHaveLength(0);
    expect(
      diagnosticsForFixture("deprecated-master-worker.cfg", "3.4", {
        deprecatedWarnings: false,
      }),
    ).toHaveLength(0);
  });
});
