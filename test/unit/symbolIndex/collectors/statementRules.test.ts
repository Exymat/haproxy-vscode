import { describe, expect, it } from "vitest";

import { parseDocument } from "../../../helpers/parse";
import { collectStatementRuleSites } from "../../../../src/symbolIndex/collectors/statementRules";
import { createSymbolBuildContext } from "../../../../src/symbolIndex/context";
import type { SymbolSite } from "../../../../src/symbolIndex/types";

import { doc, schema } from "../helpers";

describe("statementRules collector", () => {
  it("collects ACL definitions and server definitions", () => {
    const parsed = parseDocument(
      doc("frontend web\n    acl is_api path_beg /api\nbackend api\n    server web1 127.0.0.1:80"),
      "3.4",
    );
    const definitions = new Map<string, SymbolSite[]>();
    const references: SymbolSite[] = [];
    const context = createSymbolBuildContext(schema);

    collectStatementRuleSites(parsed[1], schema, "frontend:web", definitions, references, context);
    collectStatementRuleSites(parsed[3], schema, "backend:api", definitions, references, context);

    expect(definitions.get("acl:frontend:web:is_api")).toHaveLength(1);
    expect(definitions.get("server:backend:api:web1")).toHaveLength(1);
  });

  it("collects backend references from use_backend", () => {
    const parsed = parseDocument(
      doc("frontend web\n    use_backend api if { always_true }"),
      "3.4",
    );
    const definitions = new Map<string, SymbolSite[]>();
    const references: SymbolSite[] = [];
    const context = createSymbolBuildContext(schema);
    collectStatementRuleSites(parsed[1], schema, "frontend:web", definitions, references, context);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "proxy-section", name: "api", role: "reference" }),
      ]),
    );
  });
});
