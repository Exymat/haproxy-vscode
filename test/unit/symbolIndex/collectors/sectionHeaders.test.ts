import { describe, expect, it } from "vitest";

import { parseDocument } from "../../../helpers/parse";
import { collectSectionHeaderSites } from "../../../../src/symbolIndex/collectors/sectionHeaders";
import { scopedSymbolKindSet } from "../../../../src/symbolIndex/types";
import type { SymbolSite } from "../../../../src/symbolIndex/types";

import { doc, schema } from "../helpers";

describe("sectionHeaders collector", () => {
  it("collects section definitions and defaults-profile references", () => {
    const parsed = parseDocument(
      doc("defaults profile_default\n    mode http\nfrontend web from profile_default"),
      "3.4",
    );
    const definitions = new Map<string, SymbolSite[]>();
    const references: SymbolSite[] = [];
    const scopedKinds = scopedSymbolKindSet(schema);

    collectSectionHeaderSites(parsed[0], schema, definitions, references, scopedKinds);
    collectSectionHeaderSites(parsed[2], schema, definitions, references, scopedKinds);

    expect(definitions.get("defaults-profile:profile_default")).toHaveLength(1);
    expect(definitions.get("proxy-section:web")).toHaveLength(1);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "defaults-profile",
          name: "profile_default",
          role: "reference",
        }),
      ]),
    );
  });

  it("ignores single-token section headers", () => {
    const parsed = parseDocument(doc("global\n    daemon"), "3.4");
    const definitions = new Map<string, SymbolSite[]>();
    const references: SymbolSite[] = [];
    collectSectionHeaderSites(
      parsed[0],
      schema,
      definitions,
      references,
      scopedSymbolKindSet(schema),
    );
    expect(definitions.size).toBe(0);
    expect(references).toEqual([]);
  });
});
