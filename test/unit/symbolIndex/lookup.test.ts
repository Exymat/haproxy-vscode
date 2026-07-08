import { parseDocument } from "../../../src/parser";
import {
  buildSymbolIndex,
  findAllSites,
  findReferences,
  findSiteAtPosition,
} from "../../../src/symbolIndex";
import { effectiveScopeKeyForSchema } from "../../../src/symbolIndex/types";
import { buildSitesByLine } from "../../../src/symbolIndex/utils";

import { doc, pos, schema } from "./helpers";

describe("symbolIndex lookup", () => {
  it("uses schema metadata to decide scoped symbol kinds", () => {
    expect(effectiveScopeKeyForSchema(schema, "server", "backend:api")).toBe("backend:api");
    expect(effectiveScopeKeyForSchema(schema, "proxy-section", "frontend:web")).toBeNull();
  });

  it("findAllSites returns both definitions and references", () => {
    const parsed = parseDocument(
      doc("defaults base\nfrontend web from base\nbackend api\n    use_backend api if TRUE"),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findAllSites(index, "defaults-profile", "base", null)).toHaveLength(2);
  });

  it("findReferences returns empty array when symbol has no references", () => {
    const parsed = parseDocument(doc("backend api\n    server s1 127.0.0.1:80"));
    const index = buildSymbolIndex(parsed, schema);
    expect(findReferences(index, "acl", "missing", "backend:api")).toEqual([]);
  });

  it("findSiteAtPosition returns the narrowest overlapping site", () => {
    const wide = {
      kind: "proxy-section",
      name: "wide",
      line: 0,
      start: 0,
      end: 10,
      scopeKey: null,
      role: "reference",
    } as const;
    const narrow = {
      kind: "acl",
      name: "narrow",
      line: 0,
      start: 2,
      end: 5,
      scopeKey: "frontend:web",
      role: "reference",
    } as const;
    expect(
      findSiteAtPosition(
        {
          definitions: new Map(),
          references: [wide, narrow],
          referencesByKey: new Map(),
          scopeKeyByLine: [null],
          scopedSymbolKinds: new Set(["acl", "server", "filter"]),
          sitesByLine: buildSitesByLine(1, new Map(), [wide, narrow]),
          unresolvedReferences: [],
        },
        pos(0, 3),
      ),
    ).toEqual(narrow);
  });
});
