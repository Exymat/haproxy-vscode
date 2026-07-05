import { parseDocument } from "../../src/parser";
import * as parseCache from "../../src/parseCache";
import { getParsedDocument, getParsedDocumentEntry } from "../../src/parseCache";
import { aclReferenceAt, collectLineSymbolSites } from "../../src/symbolIndex/build";
import {
  buildSymbolIndex,
  findAllSites,
  findDefinitions,
  findReferences,
  findSiteAtPosition,
  getSymbolIndex,
  resolveSymbolAtPosition,
  symbolKeyForSchema,
} from "../../src/symbolIndex";
import { effectiveScopeKeyForSchema } from "../../src/symbolIndex/types";
import { buildSitesByLine } from "../../src/symbolIndex/utils";
import { createDocument, updateDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";
import type { Position, TextDocument } from "vscode";
import { vi } from "vitest";

const schema = loadSchema("3.4");

function pos(line: number, character: number) {
  return { line, character } as Position;
}

function doc(content: string): TextDocument {
  return createDocument(content);
}

describe("symbolIndex extended", () => {
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

  it("getSymbolIndex returns null above max lines", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => (i === 0 ? "global" : "    # pad"));
    const document = doc(lines.join("\n"));
    expect(getSymbolIndex(document, schema, 4000)).toBeNull();
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

  it("resolveSymbolAtPosition returns null without tokens", () => {
    const document = doc("global\n    # comment");
    expect(resolveSymbolAtPosition(document, pos(1, 2), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null off token", () => {
    const document = doc("global\n    daemon");
    expect(resolveSymbolAtPosition(document, pos(1, 0), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition resolves statement rule definitions", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const serverCol = "    server s1".indexOf("s1");
    expect(resolveSymbolAtPosition(document, pos(1, serverCol), schema)).toEqual({
      kind: "server",
      name: "s1",
      scopeKey: "backend:api",
    });
  });

  it("resolveSymbolAtPosition uses caller-provided scope arrays", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const serverCol = "    server s1".indexOf("s1");
    expect(
      resolveSymbolAtPosition(document, pos(1, serverCol), schema, [null, "backend:other"]),
    ).toEqual({
      kind: "server",
      name: "s1",
      scopeKey: "backend:other",
    });
    expect(resolveSymbolAtPosition(document, pos(1, serverCol), schema, [null])).toEqual({
      kind: "server",
      name: "s1",
      scopeKey: null,
    });
  });

  it("resolveSymbolAtPosition resolves defaults from references", () => {
    const document = doc("defaults profile_a\nfrontend web from profile_a");
    const fromCol = "frontend web from profile_a".indexOf("profile_a");
    expect(resolveSymbolAtPosition(document, pos(1, fromCol), schema)).toEqual({
      kind: "defaults-profile",
      name: "profile_a",
      scopeKey: null,
    });
  });

  it("resolveSymbolAtPosition ignores the section-header from keyword itself", () => {
    const document = doc("defaults profile_a\nfrontend web from profile_a");
    const fromCol = "frontend web from profile_a".indexOf("from");
    expect(resolveSymbolAtPosition(document, pos(1, fromCol), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null for unknown tokens in scope", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    expect(resolveSymbolAtPosition(document, pos(1, 6), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null for unsupported section headers", () => {
    const document = doc("mailers smtp\n    mailer m1 127.0.0.1:25");
    expect(resolveSymbolAtPosition(document, pos(0, 0), schema)).toBeNull();
    expect(resolveSymbolAtPosition(document, pos(0, 8), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null on section header tokens without symbols", () => {
    const document = doc("frontend web extra");
    expect(resolveSymbolAtPosition(document, pos(0, 0), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition resolves proxy section names", () => {
    const document = doc("frontend web\n    bind :80");
    const col = "frontend web".indexOf("web");
    expect(resolveSymbolAtPosition(document, pos(0, col), schema)).toEqual({
      kind: "proxy-section",
      name: "web",
      scopeKey: null,
    });
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

  it("resolveSymbolAtPosition returns null for indented section headers", () => {
    const document = doc("    frontend web");
    expect(resolveSymbolAtPosition(document, pos(0, 10), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null for missing acl token", () => {
    const document = doc("frontend web\n    http-request deny if");
    expect(resolveSymbolAtPosition(document, pos(1, 30), schema)).toBeNull();
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

  it("resolveSymbolAtPosition returns null when no statement rules exist", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = undefined as never;
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const col = "    server s1".indexOf("s1");
    expect(resolveSymbolAtPosition(document, pos(1, col), customSchema)).toBeNull();
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

  it("resolveSymbolAtPosition keeps null scope in non-proxy sections", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "use_backend",
        kind: "directive",
        reference_kind: "proxy-section",
        value_token_index: 1,
      },
    ];
    const document = doc("global\n    use_backend api");
    const col = "    use_backend api".indexOf("api");
    expect(resolveSymbolAtPosition(document, pos(1, col), customSchema)).toEqual({
      kind: "proxy-section",
      name: "api",
      scopeKey: null,
    });
  });

  it("resolveSymbolAtPosition ignores reference rules when the cursor is not on the target", () => {
    const document = doc("frontend web\n    use_backend api");
    const directiveCol = "    use_backend api".indexOf("use_backend");
    expect(resolveSymbolAtPosition(document, pos(1, directiveCol), schema)).toBeNull();
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

  it("resolveSymbolAtPosition ignores malformed section headers", () => {
    const document = doc("frontend web extra\n    bind :80");
    const col = "frontend web extra".indexOf("extra");
    expect(resolveSymbolAtPosition(document, pos(0, col), schema)).toBeNull();
  });

  it("tracks acl references introduced by unless and strips leading bang", () => {
    const parsed = parseDocument(
      doc("frontend web\n    acl blocked path_beg /admin\n    http-request deny unless !blocked"),
    );
    const index = buildSymbolIndex(parsed, schema);
    const refs = findReferences(index, "acl", "blocked", "frontend:web");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.name).toBe("blocked");
  });

  it("tracks acl references inside inline brace blocks", () => {
    const parsed = parseDocument(
      doc(
        "frontend web\n    acl blocked path_beg /admin\n    http-request deny if { blocked -m found }",
      ),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findReferences(index, "acl", "blocked", "frontend:web")).toHaveLength(1);
  });

  it("uses value token indexes for definitions and unscoped symbol keys", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "use_backend",
        kind: "directive",
        definition_kind: "proxy-section",
        value_token_index: 1,
      },
    ];
    const parsed = parseDocument(doc("frontend web\n    use_backend api"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(findDefinitions(index, "proxy-section", "api", "frontend:web")).toHaveLength(1);
    expect(symbolKeyForSchema(schema, "proxy-section", "Api", "frontend:web")).toBe(
      "proxy-section:api",
    );
  });

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

  it("tracks configured global reference patterns from schema", () => {
    const parsed = parseDocument(doc("backend api\n    default-server resolvers dns-main"));
    const index = buildSymbolIndex(parsed, schema);
    const refs = findReferences(index, "resolvers", "dns-main", null);
    expect(refs).toHaveLength(1);
  });

  it("resolves configured reference-pattern symbols at the cursor", () => {
    const document = doc("backend api\n    default-server resolvers dns-main");
    const col = "    default-server resolvers dns-main".indexOf("dns-main");
    expect(resolveSymbolAtPosition(document, pos(1, col), schema)).toEqual({
      kind: "resolvers",
      name: "dns-main",
      scopeKey: null,
    });
  });

  it("resolves configured section-scoped reference-pattern symbols at the cursor", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [];
    customSchema.reference_patterns = [
      {
        match_tokens: ["set-filter"],
        reference_kind: "filter",
        target_token_index: 1,
        scope: "section",
      },
    ];
    const document = doc("backend api\n    set-filter compression");
    const col = "    set-filter compression".indexOf("compression");
    expect(resolveSymbolAtPosition(document, pos(1, col), customSchema)).toEqual({
      kind: "filter",
      name: "compression",
      scopeKey: "backend:api",
    });
  });

  it("skips empty split references and empty sample-fetch args", () => {
    const customSchema = structuredClone(schema);
    customSchema.reference_patterns = [
      {
        match_tokens: ["set-map"],
        reference_kind: "map",
        target_token_index: 1,
        split: ",",
        scope: "global",
      },
    ] as never;
    const parsed = parseDocument(
      doc("backend api\n    set-map a,,b\n    http-request set-var(txn.x) http_auth()"),
    );
    const sites = collectLineSymbolSites(parsed[1], customSchema, "backend:api");
    expect(
      sites
        .filter((site) => site.kind === ("map" as (typeof site)["kind"]))
        .map((site) => site.name),
    ).toEqual(["a", "b"]);
    expect(collectLineSymbolSites(parsed[2], customSchema, "backend:api")).toEqual([]);
  });

  it("tracks sample-fetch references from non-first arguments with precise ranges", () => {
    const customSchema = structuredClone(schema);
    customSchema.symbols = {
      ...customSchema.symbols,
      sample_fetch_references: {
        custom_auth: {
          argument_index: 1,
          reference_kind: "userlist",
          scope: "global",
        },
      },
    };
    const content = "frontend web\n    http-request deny if custom_auth(primary,stats-auth)";
    const parsed = parseDocument(doc(content));
    const index = buildSymbolIndex(parsed, customSchema);
    const refs = findReferences(index, "userlist", "stats-auth", null);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.start).toBe(content.split(/\r?\n/)[1].indexOf("stats-auth"));
    expect(refs[0]?.end).toBe(refs[0]?.start + "stats-auth".length);
  });

  it("tracks defaults from references after unrelated section-header tokens", () => {
    const parsed = parseDocument(doc("frontend web extra from base"));
    const sites = collectLineSymbolSites(parsed[0], schema, null);
    expect(sites.some((site) => site.kind === "defaults-profile" && site.name === "base")).toBe(
      true,
    );
  });

  it("covers defensive symbol-index helpers directly", () => {
    const line = parseDocument(doc("frontend web\n    http-request deny if acl1"))[1];
    const aclOperators = new Set<string>(
      (schema.symbols?.acl_condition_operators as string[] | undefined) ?? [],
    );
    const fetchNames = new Set<string>();
    expect(aclReferenceAt(schema, line, 99, aclOperators, fetchNames)).toBeNull();

    const sparse = {
      ...line,
      tokens: [{ text: "http_auth()", start: 0, end: 11 }, undefined as never],
    };
    expect(collectLineSymbolSites(sparse as never, schema, "frontend:web")).toEqual([]);

    const malformedFetchSchema = structuredClone(schema);
    malformedFetchSchema.symbols = {
      ...malformedFetchSchema.symbols,
      sample_fetch_references: { http_auth: [], http_auth_group: { argument_index: 0 } },
    };
    expect(
      collectLineSymbolSites(
        {
          ...line,
          tokens: [{ text: "http_auth(users)", start: 0, end: 16 }],
        },
        malformedFetchSchema,
        "frontend:web",
      ),
    ).toEqual([]);

    expect(
      collectLineSymbolSites(
        {
          ...line,
          tokens: [{ text: "http_auth_group(users)", start: 0, end: 22 }],
        },
        malformedFetchSchema,
        "frontend:web",
      ),
    ).toEqual([]);

    const malformedSelfRefSchema = structuredClone(schema);
    malformedSelfRefSchema.symbols = {
      ...malformedSelfRefSchema.symbols,
      self_reference_keywords: { filter: { reference_kind: 1, token_index: 1 } },
    };
    malformedSelfRefSchema.statement_rules = [];
    expect(
      collectLineSymbolSites(
        parseDocument(doc("frontend web\n    filter trace"))[1],
        malformedSelfRefSchema,
        "frontend:web",
      ),
    ).toEqual([]);

    const globalSelfRefSchema = structuredClone(schema);
    globalSelfRefSchema.statement_rules = [];
    globalSelfRefSchema.symbols = {
      ...globalSelfRefSchema.symbols,
      self_reference_keywords: { filter: { reference_kind: "filter" } },
    };
    expect(
      collectLineSymbolSites(
        parseDocument(doc("frontend web\n    filter trace"))[1],
        globalSelfRefSchema,
        "frontend:web",
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "filter",
        name: "trace",
        scopeKey: null,
      }),
    ]);
  });
});
