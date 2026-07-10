import { describe, expect, it } from "vitest";

import { runSpecialArgumentHandlers } from "../../../src/argumentHandlers/registry";
import { DiagnosticContext } from "../../../src/diagnosticContext";
import { runLineDiagnosticPipeline } from "../../../src/diagnosticPipeline";
import { buildLineDiagnosticMemo } from "../../helpers/lineMemo";
import { createDocument } from "../../helpers/document";
import { parseDocument } from "../../helpers/parse";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("diagnostic pipeline branch behavior", () => {
  it("ignores conditional macro guard lines", () => {
    for (const content of ["global\n    .if TRUE", "global\n    .endif"]) {
      const doc = createDocument(content);
      const ctx = new DiagnosticContext(doc, bundle.schema, {
        languageData: bundle.languageData,
      });
      expect(runLineDiagnosticPipeline(ctx, parseDocument(doc)[1])).toEqual([]);
    }
  });

  it("ignores unused special argument handler rule keys", () => {
    const handlerSchema = structuredClone(bundle.schema);
    handlerSchema.validation_rules = {
      ...handlerSchema.validation_rules,
      special_argument_rules: {
        ...(handlerSchema.validation_rules.special_argument_rules as Record<string, unknown>),
        "unused-rule-key": {},
      },
    };
    const line = parseDocument(createDocument("defaults\n    mode http"))[1];

    expect(
      runSpecialArgumentHandlers({
        line,
        schema: handlerSchema,
        match: { matched: true, end: 4, keyword: "mode" },
        memo: buildLineDiagnosticMemo(line, handlerSchema, new Set(["mode"])),
        fullKeyword: undefined,
        schemaKw: undefined,
        getConditionals: () => new Set(),
      }),
    ).toBeNull();
  });
});
