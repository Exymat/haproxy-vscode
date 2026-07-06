import { describe, it } from "vitest";

import { computeDiagnostics } from "../../src/diagnostics";
import { createDocument } from "../helpers/document";
import { listGoldenFixtures, readFixture, readGoldenFixture } from "../helpers/fixtures";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("bundled config fixtures", () => {
  it.each(listGoldenFixtures())("computes diagnostics for golden/%s", (fileName) => {
    const content = readGoldenFixture(fileName);
    const doc = createDocument(content, `file://golden/${fileName}`);
    const diags = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
      deprecatedWarnings: true,
    });
    expect(Array.isArray(diags)).toBe(true);
  });

  it("computes diagnostics for diagnostics-invalid.cfg", () => {
    const content = readFixture("diagnostics-invalid.cfg");
    const doc = createDocument(content, "file://fixtures/diagnostics-invalid.cfg");
    const diags = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(diags.length).toBeGreaterThan(0);
  });

  it("has no false positives in use_backend-var.cfg", () => {
    const content = readFixture("use_backend-var.cfg");
    const doc = createDocument(content, "file://fixtures/use_backend-var.cfg");
    const diags = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
      missingReferences: true,
      unusedSymbols: false,
    });
    expect(diags).toEqual([]);
  });
});
