import { describe, expect, it } from "vitest";

import { parseDocument } from "../../../helpers/parse";
import { collectRuntimeVariableSites } from "../../../../src/symbolIndex/collectors/runtimeVars";
import type { SymbolKind, SymbolSite } from "../../../../src/symbolIndex/types";

import { doc } from "../helpers";

function collect(content: string, lineNo: number) {
  const parsed = parseDocument(doc(content), "3.4");
  const definitions = new Map<string, SymbolSite[]>();
  const references: SymbolSite[] = [];
  collectRuntimeVariableSites(parsed[lineNo], new Set<SymbolKind>(), definitions, references);
  return { definitions, references };
}

describe("runtimeVars collector", () => {
  it("collects set-var definitions and var() references", () => {
    const { definitions, references } = collect(
      "frontend web\n    http-request set-var(txn.host) req.hdr(host)\n    use_backend %[var(txn.host)]",
      1,
    );
    expect([...definitions.values()].flat()).toEqual([
      expect.objectContaining({
        kind: "variable",
        name: "txn.host",
        role: "definition",
        scopeKey: null,
      }),
    ]);
    const refs = collect(
      "frontend web\n    http-request set-var(txn.host) req.hdr(host)\n    use_backend %[var(txn.host)]",
      2,
    ).references;
    expect(refs).toEqual([
      expect.objectContaining({ kind: "variable", name: "txn.host", role: "reference" }),
    ]);
    expect(references).toEqual([]);
  });

  it("collects unparenthesized global set-var definitions", () => {
    const { definitions } = collect('global\n    set-var proc.state str("up")', 1);
    expect([...definitions.values()].flat().map((site) => site.name)).toEqual(["proc.state"]);
  });

  it("collects at most one unparenthesized definition from a statement", () => {
    const { definitions } = collect(
      'global\n    set-var proc.state str("up") set-var proc.duplicate',
      1,
    );
    expect([...definitions.values()].flat().map((site) => site.name)).toEqual(["proc.state"]);
  });

  it("skips invalid unparenthesized variable names", () => {
    const { definitions } = collect("global\n    set-var 1bad value", 1);
    expect(definitions.size).toBe(0);
  });
});
