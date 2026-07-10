import { parseDocument } from "../../../src/parser";
import * as parseCache from "../../../src/parseCache";
import { getParsedDocument, getParsedDocumentEntry } from "../../../src/parseCache";
import type { HaproxySchema, StatementRule } from "../../../src/schema";
import { buildScopeKeyByLine, collectLineSymbolSites } from "../../../src/symbolIndex/build";
import { clearSymbolIndexCaches, hasUriSymbolIndexCache } from "../../../src/symbolIndex/cache";
import {
  buildSymbolIndex,
  findDefinitions,
  findReferences,
  findSiteAtPosition,
  getSymbolIndex,
  resolveSymbolAtPosition,
} from "../../../src/symbolIndex";
import { createDocument, updateDocument } from "../../helpers/document";
import { vi } from "vitest";

import { doc, pos, schema } from "./helpers";

function schemaWithCustomRule(
  version: string,
  definitionKind: StatementRule["definition_kind"],
): HaproxySchema {
  const customSchema = structuredClone(schema);
  customSchema.version = version;
  customSchema.statement_rules = [
    ...(customSchema.statement_rules ?? []),
    {
      keyword: "custom-symbol",
      kind: "directive",
      definition_kind: definitionKind,
      symbol_name_token_index: 1,
    },
  ];
  return customSchema;
}

describe("symbolIndex build", () => {
  it("buildSymbolIndex tracks global sections without proxy scope", () => {
    const parsed = parseDocument(doc("global\n    daemon\ncache c1\n    total-max-size 4"));
    const index = buildSymbolIndex(parsed, schema);
    expect(index.definitions.get("cache:c1")?.length).toBe(1);
    expect(index.references.length).toBe(0);
  });

  it("buildSymbolIndex handles single-token section headers", () => {
    const parsed = parseDocument(doc("global\n    daemon"));
    const index = buildSymbolIndex(parsed, schema);
    expect(index.definitions.get("proxy-section:global")).toBeUndefined();
    expect(index.references.length).toBe(0);
  });

  it("getSymbolIndex caches by document version", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const first = getSymbolIndex(document, schema, 4000);
    const second = getSymbolIndex(document, schema, 4000);
    expect(first).toBe(second);
    expect(first?.definitions.get("proxy-section:api")?.length).toBe(1);
  });

  it("clearSymbolIndexCaches clears document and URI symbol indexes", () => {
    const document = createDocument(
      "backend api\n    server s1 127.0.0.1:80",
      "file:///symbol-index-clear.cfg",
    );
    const first = getSymbolIndex(document, schema, 4000);
    expect(first).not.toBeNull();
    expect(hasUriSymbolIndexCache(document)).toBe(true);

    clearSymbolIndexCaches();

    expect(hasUriSymbolIndexCache(document)).toBe(false);
    const second = getSymbolIndex(document, schema, 4000);
    expect(second).not.toBe(first);
    expect(second?.definitions.get("proxy-section:api")?.length).toBe(1);
    clearSymbolIndexCaches();
  });

  it("getSymbolIndex keeps same-version schema object identities separate", () => {
    clearSymbolIndexCaches();
    const document = createDocument(
      "frontend web\n    custom-symbol target",
      "file:///schema-identity.cfg",
    );
    const aclSchema = schemaWithCustomRule("identity-test", "acl");
    const filterSchema = schemaWithCustomRule("identity-test", "filter");

    const first = getSymbolIndex(document, aclSchema, 4000);
    const second = getSymbolIndex(document, filterSchema, 4000);

    expect(second).not.toBe(first);
    expect(first?.definitions.get("acl:frontend:web:target")).toHaveLength(1);
    expect(second?.definitions.get("acl:frontend:web:target")).toBeUndefined();
    expect(second?.definitions.get("filter:frontend:web:target")).toHaveLength(1);
    expect(document.version).toBe(1);
    clearSymbolIndexCaches();
  });

  it("getSymbolIndex keeps URI cache entries separate by schema identity", () => {
    clearSymbolIndexCaches();
    const content = "frontend web\n    custom-symbol target";
    const firstDocument = createDocument(content, "file:///schema-uri-identity.cfg");
    const oldSchema = structuredClone(schema);
    oldSchema.version = "identity-old";
    const newSchema = schemaWithCustomRule("identity-new", "acl");

    const first = getSymbolIndex(firstDocument, oldSchema, 4000);
    const reopened = createDocument(content, firstDocument.uri.toString());
    const second = getSymbolIndex(reopened, newSchema, 4000);

    expect(second).not.toBe(first);
    expect(first?.definitions.get("acl:frontend:web:target")).toBeUndefined();
    expect(second?.definitions.get("acl:frontend:web:target")).toHaveLength(1);
    expect(firstDocument.version).toBe(1);
    expect(reopened.version).toBe(1);
    clearSymbolIndexCaches();
  });

  it("lazy-builds sitesByLine on first findSiteAtPosition after cold index", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const index = getSymbolIndex(document, schema, 4000);
    expect(index?.sitesByLine).toEqual([]);
    expect(index).not.toBeNull();
    if (!index) {
      return;
    }
    const character = "    server s1 127.0.0.1:80".indexOf("s1");
    const site = findSiteAtPosition(index, pos(1, character));
    expect(site?.kind).toBe("server");
    expect(index?.sitesByLine.length).toBe(2);
  });

  it("getSymbolIndex returns null above max lines", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => (i === 0 ? "global" : "    # pad"));
    const document = doc(lines.join("\n"));
    expect(getSymbolIndex(document, schema, 4000)).toBeNull();
  });

  it("tracks environment variable definitions and references", () => {
    const content = [
      "global",
      "    setenv FOO bar",
      "    presetenv BAR baz",
      '    log "${FOO-default}:514" local0',
      '    user "$BAR"',
      '    http-request set-header X-Foo "%[env(FOO)]"',
      "    http-request deny if { env(BAR) -m found }",
      "    unsetenv FOO",
      "    resetenv FOO BAR",
    ].join("\n");
    const parsed = parseDocument(doc(content));
    const index = buildSymbolIndex(parsed, schema);

    expect(findDefinitions(index, "environment-variable", "FOO", null)).toHaveLength(1);
    expect(findDefinitions(index, "environment-variable", "BAR", null)).toHaveLength(1);

    const fooRefs = findReferences(index, "environment-variable", "FOO", null);
    expect(fooRefs.map((ref) => [ref.line, ref.start, ref.end])).toEqual([
      [3, '    log "${'.length, '    log "${FOO'.length],
      [
        5,
        '    http-request set-header X-Foo "%[env('.length,
        '    http-request set-header X-Foo "%[env(FOO'.length,
      ],
      [7, "    unsetenv ".length, "    unsetenv FOO".length],
      [8, "    resetenv ".length, "    resetenv FOO".length],
    ]);

    const barRefs = findReferences(index, "environment-variable", "BAR", null);
    expect(barRefs.map((ref) => [ref.line, ref.start, ref.end])).toEqual([
      [4, '    user "$'.length, '    user "$BAR'.length],
      [6, "    http-request deny if { env(".length, "    http-request deny if { env(BAR".length],
      [8, "    resetenv FOO ".length, "    resetenv FOO BAR".length],
    ]);
  });

  it("skips invalid resetenv names and resolves valid unset/reset references", () => {
    const document = doc("global\n    resetenv 1BAD FOO\n    unsetenv FOO");
    const parsed = parseDocument(document);
    const index = buildSymbolIndex(parsed, schema);

    expect(index.references.filter((site) => site.kind === "environment-variable")).toHaveLength(2);
    expect(
      resolveSymbolAtPosition(document as never, pos(1, "    resetenv 1BAD ".length), schema),
    ).toEqual({
      kind: "environment-variable",
      name: "FOO",
      scopeKey: null,
    });
    expect(
      resolveSymbolAtPosition(document as never, pos(2, "    unsetenv ".length), schema),
    ).toEqual({
      kind: "environment-variable",
      name: "FOO",
      scopeKey: null,
    });
  });

  it("tracks only documented environment variable reference forms", () => {
    const content = [
      "global",
      "    setenv LIST one two",
      '    log "${LIST[*]}" local0',
      "    log $LIST local0",
      "    log '$LIST' local0",
      '    log "\\$LIST" local0',
    ].join("\n");
    const parsed = parseDocument(doc(content));
    const index = buildSymbolIndex(parsed, schema);

    expect(findReferences(index, "environment-variable", "LIST", null)).toHaveLength(1);
    const [ref] = findReferences(index, "environment-variable", "LIST", null);
    expect(ref).toMatchObject({
      line: 2,
      start: '    log "${'.length,
      end: '    log "${LIST'.length,
    });
  });

  it("getSymbolIndex reuses index when a single-line edit does not change symbols", () => {
    const document = doc("global\n    maxconn 4096\nbackend api\n    server s1 127.0.0.1:80");
    getParsedDocument(document);
    const first = getSymbolIndex(document, schema, 4000);
    updateDocument(document, "global\n    maxconn 8192\nbackend api\n    server s1 127.0.0.1:80");
    getParsedDocument(document);
    const second = getSymbolIndex(document, schema, 4000);
    expect(second).toBe(first);
  });

  it("getSymbolIndex rebuilds when a single-line edit changes a symbol definition", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    getParsedDocument(document);
    const first = getSymbolIndex(document, schema, 4000);
    updateDocument(document, "backend api\n    server s2 127.0.0.1:80");
    getParsedDocument(document);
    const second = getSymbolIndex(document, schema, 4000);
    expect(second).not.toBe(first);
    expect(second?.definitions.get("server:backend:api:s2")).toHaveLength(1);
    expect(second?.definitions.get("proxy-section:api")).toHaveLength(1);
  });

  it("getSymbolIndex rebuilds when a single-line edit changes a symbol reference", () => {
    const document = doc("backend api\nfrontend web\n    default_backend api");
    getParsedDocument(document);
    const first = getSymbolIndex(document, schema, 4000);
    updateDocument(document, "backend api\nfrontend web\n    default_backend other");
    getParsedDocument(document);
    const second = getSymbolIndex(document, schema, 4000);
    expect(second).not.toBe(first);
    expect(second).not.toBeNull();
    if (!second) {
      return;
    }
    expect(findReferences(second, "proxy-section", "other", null)).toHaveLength(1);
  });

  it("getSymbolIndex updates reference ranges when whitespace changes without renaming", () => {
    const document = doc("backend api\nfrontend web\n    default_backend api");
    getParsedDocument(document);
    getSymbolIndex(document, schema, 4000);

    updateDocument(document, "backend api\nfrontend web\n        default_backend api");
    getParsedDocument(document);
    const shiftedRight = getSymbolIndex(document, schema, 4000);
    expect(shiftedRight).not.toBeNull();
    if (!shiftedRight) {
      return;
    }
    expect(
      findSiteAtPosition(shiftedRight, pos(2, "        default_backend ".length)),
    ).toMatchObject({
      kind: "proxy-section",
      role: "reference",
      name: "api",
      start: "        default_backend ".length,
      end: "        default_backend api".length,
    });

    updateDocument(document, "backend api\nfrontend web\n  default_backend api");
    getParsedDocument(document);
    const shiftedLeft = getSymbolIndex(document, schema, 4000);
    expect(shiftedLeft).not.toBeNull();
    if (!shiftedLeft) {
      return;
    }
    expect(findSiteAtPosition(shiftedLeft, pos(2, "  default_backend ".length))).toMatchObject({
      kind: "proxy-section",
      role: "reference",
      name: "api",
      start: "  default_backend ".length,
      end: "  default_backend api".length,
    });
  });

  it("getSymbolIndex rebuilds when a section header line is edited", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    getParsedDocument(document);
    const first = getSymbolIndex(document, schema, 4000);
    updateDocument(document, "backend renamed\n    server s1 127.0.0.1:80");
    getParsedDocument(document);
    const second = getSymbolIndex(document, schema, 4000);
    expect(second).not.toBe(first);
    expect(second?.definitions.get("proxy-section:renamed")).toHaveLength(1);
  });

  it("getSymbolIndex rebuilds when line count changes", () => {
    const document = doc("global\n    maxconn 4096");
    getParsedDocument(document);
    const first = getSymbolIndex(document, schema, 4000);
    updateDocument(document, "global\n    maxconn 4096\n    daemon");
    getParsedDocument(document);
    const second = getSymbolIndex(document, schema, 4000);
    expect(second).not.toBe(first);
  });

  it("getSymbolIndex rebuilds when parse reuse has no previous version", () => {
    const document = doc("global\n    maxconn 4096");
    getParsedDocument(document);
    const first = getSymbolIndex(document, schema, 4000);
    updateDocument(document, "global\n    maxconn 8192");
    const realEntry = getParsedDocumentEntry(document);
    vi.spyOn(parseCache, "getParsedDocumentEntry").mockReturnValueOnce({
      ...realEntry,
      reuse: { ...realEntry.reuse, previousVersion: null },
    });
    const second = getSymbolIndex(document, schema, 4000);
    expect(second).not.toBe(first);
    vi.restoreAllMocks();
  });

  it("getSymbolIndex rebuilds when multiple lines are reparsed", () => {
    const document = doc(
      ["defaults", "    mode http", "    # comment", "    timeout client 50s"].join("\n"),
    );
    getParsedDocument(document);
    const first = getSymbolIndex(document, schema, 4000);
    updateDocument(
      document,
      ["defaults", "    mode http", "frontend web", "    timeout client 50s"].join("\n"),
    );
    const entry = getParsedDocumentEntry(document);
    expect(entry.reuse.suffixLines).toBe(0);
    expect(entry.parsed.length - entry.reuse.prefixLines - entry.reuse.suffixLines).toBeGreaterThan(
      1,
    );
    const second = getSymbolIndex(document, schema, 4000);
    expect(second).not.toBe(first);
  });

  it("buildSymbolIndex skips indented section headers", () => {
    const parsed = parseDocument(doc("    frontend web from profile_a"));
    const index = buildSymbolIndex(parsed, schema);
    expect(index.definitions.get("proxy-section:web")).toBeUndefined();
    expect(index.references.length).toBe(0);
  });

  it("buildSymbolIndex uses fixed slot name roles for definitions", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "filter",
        kind: "filter",
        definition_kind: "filter",
        fixed_slots: [{ role: "name" }],
      },
    ];
    const parsed = parseDocument(doc("backend api\n    filter compression"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.definitions.get("filter:backend:api:compression")?.length).toBe(1);
  });

  it("buildSymbolIndex skips definitions without name tokens", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "filter",
        kind: "filter",
        definition_kind: "filter",
        fixed_slots: [{ role: "name" }],
      },
    ];
    const parsed = parseDocument(doc("backend api\n    filter"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.definitions.get("filter:backend:api:undefined")).toBeUndefined();
    expect(index.definitions.size).toBe(1);
  });

  it("handles prefixed statement rules without keyword match", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "set-var",
        kind: "http-request",
        prefix: "http-request",
        definition_kind: "acl",
        value_token_index: 2,
      },
    ];
    const parsed = parseDocument(doc("frontend web\n    http-request deny"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.definitions.size).toBe(1);
  });

  it("buildSymbolIndex handles undefined statement rules", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = undefined as never;
    const parsed = parseDocument(doc("frontend web\n    acl blocked path_beg /admin"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.references.length).toBeGreaterThanOrEqual(0);
  });

  it("buildSymbolIndex skips matching symbol rules without name-token metadata", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "custom-rule",
        kind: "directive",
        definition_kind: "acl",
      },
      {
        keyword: "custom-rule",
        kind: "directive",
        reference_kind: "acl",
      },
    ];
    customSchema.reference_patterns = undefined;

    const parsed = parseDocument(doc("frontend web\n    custom-rule value"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.definitions.get("acl:frontend:web:value")).toBeUndefined();
    expect(index.references).toEqual([]);
  });

  it("buildSymbolIndex skips references when statement rule token is missing", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "use_backend",
        kind: "directive",
        reference_kind: "proxy-section",
        value_token_index: 1,
      },
    ];
    const parsed = parseDocument(doc("frontend web\n    use_backend"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.references).toEqual([]);
  });

  it("buildScopeKeyByLine clears scope for named non-proxy sections", () => {
    const parsed = parseDocument(doc("frontend web\ncache c1\n    total-max-size 4"));
    expect(buildScopeKeyByLine(parsed, schema)).toEqual(["frontend:web", null, null]);
  });

  it("tracks defaults from references after unrelated section-header tokens", () => {
    const parsed = parseDocument(doc("frontend web extra from base"));
    const sites = collectLineSymbolSites(parsed[0], schema, null);
    expect(sites.some((site) => site.kind === "defaults-profile" && site.name === "base")).toBe(
      true,
    );
  });
});
