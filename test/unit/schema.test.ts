import * as fs from "node:fs";

import {
  buildPrefixSubcommands,
  clearSchemaCache,
  conditionalTokenSet,
  loadSchema,
  loadSchemaAsync,
  modifierPrefixSet,
  namedDefaultsKeywordSet,
  noPrefixKeywordSet,
  keywordGroupSet,
  optionsWithValueSet,
  prefixFamilies,
  prefixFamilySet,
  prefixSubcommandSet,
  actionGroupForCompletionKind,
  schemaAddressPolicies,
  sampleExpressionNameSets,
  schemaAddressPolicy,
  schemaSampleCasts,
  schemaSampleTypes,
  sectionKeywordSet,
  sectionHeaderSet,
  sectionNames,
  semanticStringMap,
  semanticStringList,
  statsSocketLevelSet,
  symbolStringMap,
  symbolStringList,
  tcpRequestPhaseSet,
  tcpResponsePhaseSet,
  validationStringMap,
  validationStringList,
} from "../../src/schema";
import { resetVscodeMock } from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";
import { loadSchema as loadFixtureSchema } from "../helpers/schema";
import { createTempSchemaFixture } from "../helpers/tempSchema";

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
    expect(first.reference_patterns?.length).toBeGreaterThan(0);
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

  it("throws when schema file is missing", () => {
    expect(() => loadSchema({ extensionPath: "/nonexistent" } as never, "3.4")).toThrow(
      /Failed to load HAProxy schema for 3\.4/,
    );
  });

  it("rejects schemas missing required generated metadata collections", () => {
    const valid = {
      version: "3.4",
      sections: {},
      keywords: {},
      statement_rules: [],
      address_policies: {
        bind: { portOk: true, portMandatory: true, portRange: true, portOffset: false },
      },
      sample_types: ["any"],
      sample_casts: [[true]],
      symbols: {},
      semantic_groups: {},
      validation_rules: {},
      tokens: {},
    };
    const cases = [
      "sample_types",
      "sample_casts",
      "symbols",
      "semantic_groups",
      "validation_rules",
      "tokens",
    ] as const;

    for (const missing of cases) {
      const fixture = createTempSchemaFixture(`haproxy-missing-${missing}-`, {
        "haproxy-3.4.schema.json": JSON.stringify({
          ...valid,
          [missing]: undefined,
        }),
      });
      try {
        clearSchemaCache();
        expect(() => loadSchema({ extensionPath: fixture.extensionPath } as never, "3.4")).toThrow(
          new RegExp(`missing ${missing}`),
        );
      } finally {
        fixture.cleanup();
      }
    }
  });

  it("throws when async schema load fails", async () => {
    await expect(
      loadSchemaAsync({ extensionPath: "/nonexistent" } as never, "3.4"),
    ).rejects.toThrow(/Failed to load HAProxy schema for 3\.4/);
  });

  it("wraps non-Error throws from async schema load", async () => {
    const context = mockExtensionContext();
    const readSpy = vi.spyOn(fs.promises, "readFile").mockRejectedValue("async-boom");
    await expect(loadSchemaAsync(context as never, "3.4")).rejects.toThrow(
      /Failed to load HAProxy schema.*async-boom/,
    );
    readSpy.mockRestore();
  });

  it("throws when sync schema file contains invalid JSON", () => {
    clearSchemaCache();
    const fixture = createTempSchemaFixture("haproxy-schema-error-", {
      "haproxy-3.4.schema.json": "{not-json",
    });
    try {
      expect(() => loadSchema({ extensionPath: fixture.extensionPath } as never, "3.4")).toThrow(
        /Failed to load HAProxy schema for 3\.4/,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("sectionHeaderSet uses schema line_layout headers when provided", () => {
    const schema = loadFixtureSchema("3.4");
    const custom = structuredClone(schema);
    custom.line_layout = { section_headers: ["custom-proxy"] };
    expect(sectionHeaderSet(custom).has("custom-proxy")).toBe(true);
    expect(sectionHeaderSet(custom).has("global")).toBe(false);
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
    expect(prefixFamilySet(schema)).toBe(prefixFamilySet(schema));
    expect(prefixFamilySet(schema).has("stats")).toBe(true);
    const first = prefixSubcommandSet(schema, "stats");
    const second = prefixSubcommandSet(schema, "stats");
    expect(first).toBe(second);
    expect(first.has("socket")).toBe(true);
  });

  it("caches optionsWithValueSet per group", () => {
    const first = optionsWithValueSet(schema, "bind_options");
    const second = optionsWithValueSet(schema, "bind_options");
    expect(first).toBe(second);
    expect(first.size).toBeGreaterThan(0);
    expect(
      schema.keywords.crt?.line_option_semantics?.some((item) => item.parent_kind === "bind"),
    ).toBe(true);
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
    expect(statsSocketLevelSet(schema)).toBe(statsSocketLevelSet(schema));
  });

  it("exposes generated source metadata payloads", () => {
    expect(schemaAddressPolicy(schema, "bind")).toEqual({
      portOk: true,
      portMandatory: true,
      portRange: true,
      portOffset: false,
    });
    expect(() => schemaAddressPolicy(schema, "missing-policy")).toThrow(/address_policies/);
    expect(schemaSampleTypes(schema)).toEqual([
      "any",
      "same",
      "bool",
      "sint",
      "addr",
      "ipv4",
      "ipv6",
      "str",
      "bin",
      "meth",
    ]);
    expect(schemaSampleCasts(schema)[0][0]).toBe(true);
    expect(symbolStringList(schema, "runtime_modes")).toContain("http");
    expect(semanticStringList(schema, "action_groups")).toContain("http_request_actions");
    expect(actionGroupForCompletionKind(schema, "http-request")).toBe("http_request_actions");
    expect(validationStringList(schema, "log_address_skip")).toContain("stdout");
  });

  it("falls back when line_layout metadata is absent", () => {
    const bare = structuredClone(schema);
    bare.line_layout = {};
    expect(sectionHeaderSet(bare).has("global")).toBe(true);
    expect(prefixSubcommandSet(bare, "stats").size).toBeGreaterThan(0);
    expect(tcpRequestPhaseSet(bare).size).toBeGreaterThan(0);
    expect(tcpResponsePhaseSet(bare).size).toBeGreaterThan(0);
  });

  it("requires generated source metadata", () => {
    const bare = structuredClone(schema);
    bare.address_policies = {};
    bare.sample_types = [];
    bare.sample_casts = [];
    bare.symbols = { malformed_list: ["ok", 1], malformed_map: { ok: "yes", bad: 1 } };
    bare.semantic_groups = {
      malformed_list: ["ok", 1],
      malformed_map: { ok: "yes", bad: 1 },
    };
    bare.validation_rules = {
      malformed_list: ["ok", 1],
      malformed_map: { ok: "yes", bad: 1 },
    };

    expect(() => schemaAddressPolicies(bare)).toThrow(/address_policies/);
    expect(() => schemaSampleTypes(bare)).toThrow(/sample_types/);
    expect(() => schemaSampleCasts(bare)).toThrow(/sample_casts/);
    expect(() => symbolStringList(bare, "missing")).toThrow(/symbols\.missing/);
    expect(() => symbolStringList(bare, "malformed_list")).toThrow(/malformed_list/);
    expect(() => symbolStringMap(bare, "malformed_map")).toThrow(/malformed_map/);
    expect(() => semanticStringList(bare, "missing")).toThrow(/semantic_groups\.missing/);
    expect(() => semanticStringList(bare, "malformed_list")).toThrow(/malformed_list/);
    expect(() => semanticStringMap(bare, "missing")).toThrow(/semantic_groups\.missing/);
    expect(() => semanticStringMap(bare, "malformed_map")).toThrow(/malformed_map/);
    expect(() => validationStringList(bare, "missing")).toThrow(/validation_rules\.missing/);
    expect(() => validationStringList(bare, "malformed_list")).toThrow(/malformed_list/);
    expect(() => validationStringMap(bare, "missing")).toThrow(/validation_rules\.missing/);
    expect(() => validationStringMap(bare, "malformed_map")).toThrow(/malformed_map/);
    expect(keywordGroupSet(bare, "missing")).toEqual(new Set());
  });

  it("uses keyword scan for tcp phases when layout phases are missing", () => {
    const bare = structuredClone(schema);
    bare.line_layout = { prefix_families: bare.line_layout?.prefix_families };
    expect(tcpRequestPhaseSet(bare).has("content")).toBe(true);
    expect(tcpResponsePhaseSet(bare).has("content")).toBe(true);
  });

  it("uses explicit options_with_value from keyword_groups", () => {
    expect(optionsWithValueSet(schema, "options").has("httplog")).toBe(true);
  });

  it("uses explicit bind/server *_with_value metadata", () => {
    expect(optionsWithValueSet(schema, "bind_options").has("crt")).toBe(true);
    expect(optionsWithValueSet(schema, "server_options").has("cookie")).toBe(true);
  });

  it("uses only generated *_with_value metadata for value-taking options", () => {
    const bare = structuredClone(schema);
    delete bare.keyword_groups.bind_options_with_value;
    bare.keyword_groups.bind_options = ["ca-file", "strict-sni", "sni"];

    const values = optionsWithValueSet(bare, "bind_options");
    expect(values.has("ca-file")).toBe(false);
    expect(values.has("strict-sni")).toBe(false);
    expect(values.has("sni")).toBe(false);
  });

  it("combines layout tcp phases via phase set helpers", () => {
    expect(tcpRequestPhaseSet(schema).has("content")).toBe(true);
    expect(tcpResponsePhaseSet(schema).has("content")).toBe(true);
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

  it("covers sample expression metadata branches", () => {
    const bare = structuredClone(schema);
    bare.sample_fetches = {};
    bare.sample_converters = {};
    bare.keyword_groups.sample_fetches = ["hdr"];
    bare.keyword_groups.sample_converters = ["lower"];
    bare.line_layout = {};
    const sets = sampleExpressionNameSets(bare);
    expect(sets.fetchNames.has("hdr")).toBe(true);
    expect(sets.convNames.has("lower")).toBe(true);
    expect(statsSocketLevelSet(bare)).toEqual(new Set());
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

  it("uses generated prefix families only", () => {
    const bare = structuredClone(schema);
    bare.line_layout = undefined;
    expect(prefixFamilies(bare)).toEqual([]);
  });

  it("rejects schemas without generated source metadata", () => {
    clearSchemaCache();
    const fixture = createTempSchemaFixture("haproxy-schema-test-", {
      "haproxy-3.4.schema.json": JSON.stringify({
        version: "3.4",
        sections: {},
        keywords: {},
        keyword_groups: {},
        tokens: {},
      }),
    });
    try {
      expect(() => loadSchema({ extensionPath: fixture.extensionPath } as never, "3.4")).toThrow(
        /missing address_policies/,
      );
    } finally {
      fixture.cleanup();
    }
  });
});
