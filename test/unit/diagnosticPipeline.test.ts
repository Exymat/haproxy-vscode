import { describe, expect, it } from "vitest";

import { runLineDiagnosticPipeline } from "../../src/diagnosticPipeline";
import { DiagnosticContext } from "../../src/diagnosticContext";
import { parseDocument } from "../../src/parser";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("diagnosticPipeline macro lines", () => {
  it("returns no diagnostics for conditional macro directives", () => {
    const doc = createDocument("global\n    .elif defined(TEST)\n    daemon");
    const ctx = new DiagnosticContext(doc, bundle.schema, { languageData: bundle.languageData });
    const macroLine = parseDocument(doc)[1];
    expect(runLineDiagnosticPipeline(ctx, macroLine)).toEqual([]);
  });

  it("skips deprecated diagnostics when no deprecated index is present", () => {
    const doc = createDocument("defaults\n    mode http");
    const ctx = new DiagnosticContext(doc, bundle.schema, {
      languageData: bundle.languageData,
      deprecatedWarnings: false,
    });
    const line = parseDocument(doc)[1];
    expect(runLineDiagnosticPipeline(ctx, line)).toEqual([]);
  });
});
