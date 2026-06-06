import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPrefixSubcommands,
  clearSchemaCache,
  conditionalTokenSet,
  loadSchema,
  loadSchemaAsync,
  modifierPrefixSet,
  namedDefaultsKeywordSet,
  noPrefixKeywordSet,
  optionsWithValueSet,
  prefixFamilies,
  prefixSubcommandSet,
  sampleExpressionNameSets,
  sectionKeywordSet,
  sectionNames,
  statsSocketLevelSet,
  tcpRequestPhaseSet,
  tcpResponsePhaseSet,
  allTcpRulePhases,
} from "../../src/schema";
import { resetVscodeMock } from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";
import { loadSchema as loadFixtureSchema } from "../helpers/schema";

describe("loadSchema", () => {
  beforeEach(() => {
    resetVscodeMock();
    clearSchemaCache();
  });

  it("loads and caches schema by version", () => {
    const context = mockExtensionContext();
    const first = loadSchema(context as never, "3.2");
    const second = loadSchema(context as never, "3.2");
    expect(first).toBe(second);
    expect(first.version).toBe("3.2");
  });

  it("returns fresh schema after cache clear", () => {
    const context = mockExtensionContext();
    const before = loadSchema(context as never, "3.4");
    clearSchemaCache();
    const after = loadSchema(context as never, "3.4");
    expect(after).not.toBe(before);
  });

  it("loads and caches schema asynchronously by version", async () => {
    const context = mockExtensionContext();
    const first = await loadSchemaAsync(context as never, "3.2");
    const second = await loadSchemaAsync(context as never, "3.2");
    expect(first).toBe(second);
    expect(first.version).toBe("3.2");
  });
});

describe("schema helpers", () => {
  const schema = loadFixtureSchema("3.4");

  it("buildPrefixSubcommands collects subcommands after prefix", () => {
    const subs = buildPrefixSubcommands(
      ["tcp-request connection accept", "tcp-request content accept", "http-request deny"],
      "tcp-request",
    );
    expect(subs.has("connection accept")).toBe(true);
    expect(subs.has("content accept")).toBe(true);
    expect(subs.has("deny")).toBe(false);
  });

  it("exposes token sets from schema", () => {
    expect(noPrefixKeywordSet(schema).has("log")).toBe(true);
    expect(modifierPrefixSet(schema).size).toBeGreaterThan(0);
    expect(conditionalTokenSet(schema).has("if")).toBe(true);
    expect(namedDefaultsKeywordSet(schema).has("acl")).toBe(true);
  });

  it("collects tcp rule phases from line_layout", () => {
    const phases = tcpRequestPhaseSet(schema);
    expect(phases.has("connection")).toBe(true);
    expect(phases.has("content")).toBe(true);
  });

  it("exposes prefix families from line_layout", () => {
    expect(prefixFamilies(schema)).toContain("stats");
    expect(prefixSubcommandSet(schema, "stats").has("socket")).toBe(true);
  });

  it("caches optionsWithValueSet per group", () => {
    const first = optionsWithValueSet(schema, "bind_options");
    const second = optionsWithValueSet(schema, "bind_options");
    expect(first).toBe(second);
    expect(first.size).toBeGreaterThan(0);
  });

  it("returns empty sectionKeywordSet for null section", () => {
    expect(sectionKeywordSet(schema, null).size).toBe(0);
  });

  it("caches sectionKeywordSet per section", () => {
    const first = sectionKeywordSet(schema, "frontend");
    const second = sectionKeywordSet(schema, "frontend");
    expect(first).toBe(second);
    expect(first.has("bind")).toBe(true);
    expect(first.has("acl")).toBe(true);
  });

  it("lists section names sorted", () => {
    const names = sectionNames(schema);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("frontend");
    expect(names).toContain("backend");
  });

  it("exposes stats socket levels", () => {
    expect(statsSocketLevelSet(schema)).toEqual(new Set(["admin", "operator", "user"]));
  });

  it("falls back when line_layout metadata is absent", () => {
    const bare = structuredClone(schema);
    bare.line_layout = {};
    expect(prefixSubcommandSet(bare, "stats").size).toBeGreaterThan(0);
    expect(tcpRequestPhaseSet(bare).size).toBeGreaterThan(0);
    expect(tcpResponsePhaseSet(bare).size).toBeGreaterThan(0);
  });

  it("uses legacy tcp phase scan when layout phases are missing", () => {
    const bare = structuredClone(schema);
    bare.line_layout = { prefix_families: bare.line_layout?.prefix_families };
    expect(allTcpRulePhases(bare).has("content")).toBe(true);
  });

  it("uses explicit options_with_value from keyword_groups", () => {
    expect(optionsWithValueSet(schema, "options").has("httplog")).toBe(true);
  });

  it("uses explicit bind/server *_with_value metadata", () => {
    expect(optionsWithValueSet(schema, "bind_options").has("crt")).toBe(true);
    expect(optionsWithValueSet(schema, "server_options").has("cookie")).toBe(true);
  });

  it("falls back to suffix heuristics when *_with_value is absent", () => {
    const bare = structuredClone(schema);
    delete bare.keyword_groups.bind_options_with_value;
    bare.keyword_groups.bind_options = ["ca-file", "strict-sni", "sni"];

    const values = optionsWithValueSet(bare, "bind_options");
    expect(values.has("ca-file")).toBe(true);
    expect(values.has("strict-sni")).toBe(false);
    expect(values.has("sni")).toBe(false);
  });

  it("combines layout tcp phases via allTcpRulePhases", () => {
    expect(allTcpRulePhases(schema).has("content")).toBe(true);
  });

  it("falls back for missing token arrays and missing sections", () => {
    const bare = structuredClone(schema);
    bare.tokens = {};
    expect(noPrefixKeywordSet(bare)).toEqual(new Set());
    expect(modifierPrefixSet(bare)).toEqual(new Set());
    expect(conditionalTokenSet(bare)).toEqual(new Set());
    expect(namedDefaultsKeywordSet(bare)).toEqual(new Set());
    expect(sectionKeywordSet(bare, "nonexistent")).toEqual(new Set());
  });

  it("covers sample expression and stats fallback branches", () => {
    const bare = structuredClone(schema);
    bare.sample_fetches = {};
    bare.sample_converters = {};
    bare.keyword_groups.sample_fetches = ["hdr"];
    bare.keyword_groups.sample_converters = ["lower"];
    bare.line_layout = {};
    const sets = sampleExpressionNameSets(bare);
    expect(sets.fetchNames.has("hdr")).toBe(true);
    expect(sets.convNames.has("lower")).toBe(true);
    expect(statsSocketLevelSet(bare)).toEqual(new Set(["user", "operator", "admin"]));
  });

  it("handles missing sample maps and unknown option groups", () => {
    const bare = structuredClone(schema);
    bare.sample_fetches = undefined as never;
    bare.sample_converters = undefined as never;
    bare.keyword_groups.sample_fetches = undefined as never;
    bare.keyword_groups.sample_converters = undefined as never;
    expect(sampleExpressionNameSets(bare).fetchNames.size).toBe(0);
    expect(sampleExpressionNameSets(bare).convNames.size).toBe(0);
    expect(optionsWithValueSet(bare, "nonexistent_group")).toEqual(new Set());
  });

  it("falls back to default prefix families without line layout", () => {
    const bare = structuredClone(schema);
    bare.line_layout = undefined;
    expect(prefixFamilies(bare)).toContain("stats");
  });

  it("normalizes missing schema collections via loadSchema", () => {
    clearSchemaCache();
    const tempRoot = mkdtempSync(join(tmpdir(), "haproxy-schema-test-"));
    const schemasDir = join(tempRoot, "schemas");
    mkdirSync(schemasDir, { recursive: true });
    writeFileSync(
      join(schemasDir, "haproxy-3.4.schema.json"),
      JSON.stringify({
        version: "3.4",
        sections: {},
        keywords: {},
        keyword_groups: {},
        tokens: {},
      }),
      "utf-8",
    );

    const loaded = loadSchema({ extensionPath: tempRoot } as never, "3.4");
    expect(loaded.statement_rules).toEqual([]);
    expect(loaded.sample_fetches).toEqual({});
    expect(loaded.sample_converters).toEqual({});
    expect(loaded.keyword_group_contexts).toEqual({});
    expect(loaded.line_layout).toEqual({});

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
