import * as vscode from "vscode";
import { describe, expect, it } from "vitest";

import { parseDocument } from "../../helpers/parse";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";
import { provideReferences } from "../../../src/navigation";
import { buildSectionSymbols } from "../../../src/navigation/sectionOutline";
import {
  buildSymbolIndex,
  getSymbolIndex,
  getSymbolIndexVersion,
  resolveExpectedSymbolReferenceAtCompletion,
  scopedSymbolKindSet,
  type SymbolIndex,
  type SymbolSite,
} from "../../../src/symbolIndex";
import { buildLineFingerprints } from "../../../src/symbolIndex/build";
import { buildReferencesByKey, symbolNameTokenIndex } from "../../../src/symbolIndex/utils";
import { missingReferenceDiagnostics } from "../../../src/diagnostics/missingReferenceDiagnostics";
import { resolveLongestDirectiveMatch } from "../../../src/parser/tokenUtils";

const bundle = loadSchemaBundle("3.4");

describe("symbol index reference branch behavior", () => {
  it("handles directive aliases, empty outlines, fingerprints, and cache versions", () => {
    expect(
      resolveLongestDirectiveMatch(
        parseDocument(createDocument("global\n    set var txn.foo int 0"))[1],
        new Set(["set-var"]),
      ).keyword,
    ).toBe("set-var");
    expect(buildSectionSymbols([], 3)).toEqual([]);
    expect(
      buildLineFingerprints(parseDocument(createDocument("backend api")), bundle.schema),
    ).toHaveLength(1);

    const indexDoc = createDocument("backend api\n    server s1 127.0.0.1:80");
    expect(getSymbolIndexVersion(indexDoc)).toBeUndefined();
    expect(getSymbolIndex(indexDoc, bundle.schema, 100)).toBeTruthy();
    expect(getSymbolIndexVersion(indexDoc)).toBe(indexDoc.version);
  });

  it("handles empty reference lookups and non-symbol rules", () => {
    const indexDoc = createDocument("backend api\n    server s1 127.0.0.1:80");
    expect(
      provideReferences(
        indexDoc,
        new vscode.Position(0, 8),
        { includeDeclaration: false },
        bundle.schema,
        100,
      ),
    ).toEqual([]);
    expect(
      symbolNameTokenIndex({ keyword: "x", kind: "directive", fixed_slots: [{ role: "other" }] }),
    ).toBeNull();
  });

  it("deduplicates unresolved reference diagnostics", () => {
    const unresolved: SymbolSite = {
      kind: "userlist",
      name: "missing-users",
      line: 1,
      start: 10,
      end: 23,
      scopeKey: null,
      role: "reference",
    };
    const duplicateIndex: SymbolIndex = {
      definitions: new Map(),
      references: [],
      referencesByKey: new Map(),
      scopeKeyByLine: [],
      scopedSymbolKinds: scopedSymbolKindSet(bundle.schema),
      sitesByLine: [],
      unresolvedReferences: [unresolved, unresolved],
    };

    expect(missingReferenceDiagnostics(duplicateIndex, bundle.schema)).toHaveLength(1);
  });

  it("groups repeated scoped references by key", () => {
    expect(
      buildReferencesByKey(scopedSymbolKindSet(bundle.schema), [
        {
          kind: "acl",
          name: "a",
          line: 1,
          start: 0,
          end: 1,
          scopeKey: "frontend:web",
          role: "reference",
        },
        {
          kind: "acl",
          name: "a",
          line: 2,
          start: 0,
          end: 1,
          scopeKey: "frontend:web",
          role: "reference",
        },
      ]).get("acl:frontend:web:a")?.length,
    ).toBe(2);
  });

  it("does not complete environment variable definitions as references", () => {
    const envDoc = createDocument("global\n    setenv MY_VAR value");
    const envCol = "    setenv MY_VAR".indexOf("MY_VAR");
    expect(
      resolveExpectedSymbolReferenceAtCompletion(
        envDoc,
        { line: 1, character: envCol } as never,
        bundle.schema,
      ),
    ).toBeNull();

    const unsetDoc = createDocument("global\n    unsetenv FOO");
    const unsetCol = "    unsetenv FOO".indexOf("FOO");
    expect(
      resolveExpectedSymbolReferenceAtCompletion(
        unsetDoc,
        { line: 1, character: unsetCol } as never,
        bundle.schema,
      ),
    ).toBeNull();
  });

  it("builds an index with custom generated section headers", () => {
    const headerSchema = structuredClone(bundle.schema);
    headerSchema.line_layout = {
      ...(headerSchema.line_layout ?? {}),
      section_headers: [...(headerSchema.line_layout?.section_headers ?? []), "foobar"],
    };
    const headerDoc = createDocument("foobar test\n    bind :80");
    const headerParsed = parseDocument(headerDoc, "3.4", {
      sectionHeaders: new Set(
        (headerSchema.line_layout?.section_headers ?? []).map((header) => header.toLowerCase()),
      ),
    });

    expect(buildSymbolIndex(headerParsed, headerSchema).definitions.size).toBeGreaterThanOrEqual(0);
  });
});
