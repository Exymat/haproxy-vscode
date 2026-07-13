import { describe, expect, it } from "vitest";

import { computeDiagnostics } from "../../../src/diagnostics";
import { createDocument } from "../../helpers/document";
import { readFixture } from "../../helpers/fixtures";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("bundled config fixtures", () => {
  it("computes diagnostics for diagnostics-invalid.cfg", () => {
    const content = readFixture("diagnostics-invalid.cfg");
    const doc = createDocument(content, "file://fixtures/diagnostics-invalid.cfg");
    const diags = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(diags.length).toBeGreaterThan(0);
  });
});
