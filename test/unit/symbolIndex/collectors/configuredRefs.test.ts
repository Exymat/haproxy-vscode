import { describe, expect, it } from "vitest";

import { parseDocument } from "../../../helpers/parse";
import {
  collectConfiguredReferences,
  collectFilterSelfReference,
} from "../../../../src/symbolIndex/collectors/configuredRefs";
import { createSymbolBuildContext } from "../../../../src/symbolIndex/context";
import type { SymbolSite } from "../../../../src/symbolIndex/types";

import { doc, schema } from "../helpers";

describe("configuredRefs collectors", () => {
  it("collects filter self references from schema metadata", () => {
    const parsed = parseDocument(doc("frontend web\n    filter comp-res"), "3.4");
    const references: SymbolSite[] = [];
    const context = createSymbolBuildContext(schema);
    collectFilterSelfReference(
      parsed[1],
      "frontend:web",
      references,
      context.selfReferenceKeywords,
    );
    expect(references).toEqual([
      expect.objectContaining({
        kind: "filter",
        name: "comp-res",
        role: "reference",
        scopeKey: "frontend:web",
      }),
    ]);
  });

  it("skips filter self references without scope", () => {
    const parsed = parseDocument(doc("frontend web\n    filter comp-res"), "3.4");
    const references: SymbolSite[] = [];
    const context = createSymbolBuildContext(schema);
    collectFilterSelfReference(parsed[1], null, references, context.selfReferenceKeywords);
    expect(references).toEqual([]);
  });

  it("splits configured reference patterns on commas", () => {
    const customSchema = structuredClone(schema);
    customSchema.reference_patterns = [
      {
        match_tokens: ["filter-sequence"],
        reference_kind: "filter",
        target_token_index: 2,
        split: ",",
        scope: "section",
      },
    ] as never;
    const parsed = parseDocument(
      doc("frontend web\n    filter-sequence request comp-req,comp-res"),
      "3.4",
    );
    const references: SymbolSite[] = [];
    const context = createSymbolBuildContext(customSchema);
    collectConfiguredReferences(
      parsed[1],
      "frontend:web",
      references,
      customSchema.reference_patterns ?? [],
      context.fetchRules,
    );
    expect(references.map((site) => site.name)).toEqual(["comp-req", "comp-res"]);
  });
});
