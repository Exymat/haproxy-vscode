import * as fs from "node:fs";

import { clearSchemaCache, loadSchema, loadSchemaAsync } from "../../src/schema/load";
import { symbolStringMap, symbolStringList } from "../../src/schema/symbols";
import {
  hasStatementRuleKind,
  actionGroupForCompletionKind,
  statementRuleGroupForKind,
  statementRuleKinds,
  semanticStringMap,
  semanticStringList,
} from "../../src/schema/semantic";
import { validationStringMap, validationStringList } from "../../src/schema/validation";
import {
  schemaAddressPolicies,
  schemaAddressPolicy,
  schemaSampleCasts,
  schemaSampleTypes,
} from "../../src/schema/samples";
import {
  buildPrefixSubcommands,
  keywordGroupSet,
  optionsWithValueSet,
  prefixSubcommandSet,
  sectionKeywordSet,
  sectionHasOptionKeywords,
} from "../../src/schema/keywords";
import {
  logFormatDirectiveKeywordSet,
  prefixFamilies,
  prefixFamilySet,
  sectionHeaderSet,
  sectionNames,
  statsSocketLevelSet,
  tcpRequestPhaseSet,
  tcpResponsePhaseSet,
} from "../../src/schema/layout";
import {
  conditionalTokenSet,
  modifierPrefixSet,
  namedDefaultsKeywordSet,
  noPrefixKeywordSet,
  sampleExpressionNameSets,
} from "../../src/schema/tokens";
import { resetVscodeMock } from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";
import { loadSchema as loadFixtureSchema } from "../helpers/schema";
import { createTempSchemaFixture } from "../helpers/tempSchema";

describe("loadSchema", () => {
  beforeEach(() => {
    resetVscodeMock();
    clearSchemaCache();
  });

  function validGeneratedSchemaFixture(): Record<string, unknown> {
    return {
      version: "3.4",
      sections: {},
      keywords: {},
      statement_rules: [
        {
          keyword: "bind",
          kind: "bind",
          group: "bind_options",
          match_tokens: ["bind"],
          minimum_token_index: 1,
          nested_start_index: 1,
          sections: [],
          fixed_slots: [{ role: "address", port: null, address_policy: "bind" }],
        },
      ],
      address_policies: {
        bind: { portOk: true, portMandatory: true, portRange: true, portOffset: false },
      },
      sample_types: ["any", "str"],
      sample_casts: [
        [true, true],
        [true, true],
      ],
      symbols: {},
      semantic_groups: {},
      validation_rules: {},
      keyword_groups: {
        bind_options: ["ssl"],
        sample_fetches: ["hdr"],
        sample_converters: ["lower"],
      },
      keyword_group_contexts: {
        bind_options: {
          ssl: ["bind"],
        },
      },
      tokens: {
        conditionals: ["if"],
        modifiers: ["!"],
      },
      reference_patterns: [
        {
          match_tokens: ["use_backend"],
          reference_kind: "backend",
          target_token_index: 1,
          scope: "section",
          split: null,
        },
      ],
      sample_fetches: {
        hdr: {
          name: "hdr",
          args: ["string"],
          out_type: "str",
          in_type: "",
          contexts: [true],
          min_args: null,
          max_args: 1,
          signature: "hdr(<name>)",
          deprecated: false,
        },
      },
      sample_converters: {
        lower: {
          name: "lower",
          args: [],
          out_type: "str",
          in_type: "str",
          contexts: [true],
          min_args: 0,
          max_args: 0,
          signature: "lower",
          deprecated: false,
        },
      },
      line_layout: {
        prefix_families: ["stats"],
        prefix_subcommands: { stats: ["socket"] },
        tcp_request_phases: ["content"],
        tcp_response_phases: ["content"],
        stats_socket_levels: ["admin"],
        section_headers: ["global"],
      },
    };
  }

  function expectMalformedGeneratedMetadata(
    expectedPath: string,
    mutate: (data: Record<string, unknown>) => void,
  ): void {
    const data = structuredClone(validGeneratedSchemaFixture());
    mutate(data);
    const fixture = createTempSchemaFixture(`haproxy-malformed-${expectedPath}-`, {
      "haproxy-3.4.schema.json": JSON.stringify(data),
    });
    try {
      clearSchemaCache();
      expect(() => loadSchema({ extensionPath: fixture.extensionPath } as never, "3.4")).toThrow(
        new RegExp(expectedPath.replaceAll(".", "\\.")),
      );
    } finally {
      fixture.cleanup();
    }
  }

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
      keyword_groups: {},
      tokens: {},
    };
    const cases = [
      "sample_types",
      "sample_casts",
      "symbols",
      "semantic_groups",
      "validation_rules",
      "keyword_groups",
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

  it("rejects malformed generated nested metadata", () => {
    const cases: Array<{
      expectedPath: string;
      mutate: (data: Record<string, unknown>) => void;
    }> = [
      {
        expectedPath: "statement_rules.0.match_tokens",
        mutate: (data) => {
          (data.statement_rules as Array<Record<string, unknown>>)[0].match_tokens = ["bind", 1];
        },
      },
      {
        expectedPath: "keyword_groups.bind_options",
        mutate: (data) => {
          (data.keyword_groups as Record<string, unknown>).bind_options = "ssl";
        },
      },
      {
        expectedPath: "tokens.modifiers",
        mutate: (data) => {
          (data.tokens as Record<string, unknown>).modifiers = ["!", false];
        },
      },
      {
        expectedPath: "line_layout.prefix_subcommands.stats",
        mutate: (data) => {
          (
            (data.line_layout as Record<string, unknown>).prefix_subcommands as Record<
              string,
              unknown
            >
          ).stats = ["socket", 1];
        },
      },
      {
        expectedPath: "reference_patterns.0.target_token_index",
        mutate: (data) => {
          (data.reference_patterns as Array<Record<string, unknown>>)[0].target_token_index = "1";
        },
      },
      {
        expectedPath: "reference_patterns",
        mutate: (data) => {
          data.reference_patterns = {};
        },
      },
      {
        expectedPath: "reference_patterns.0.scope",
        mutate: (data) => {
          (data.reference_patterns as Array<Record<string, unknown>>)[0].scope = "proxy";
        },
      },
      {
        expectedPath: "sample_fetches.hdr.args",
        mutate: (data) => {
          (data.sample_fetches as Record<string, Record<string, unknown>>).hdr.args = "string";
        },
      },
      {
        expectedPath: "sample_converters.lower.contexts",
        mutate: (data) => {
          (data.sample_converters as Record<string, Record<string, unknown>>).lower.contexts = [
            true,
            "yes",
          ];
        },
      },
      {
        expectedPath: "sample_fetches.hdr.name",
        mutate: (data) => {
          (data.sample_fetches as Record<string, Record<string, unknown>>).hdr.name = 1;
        },
      },
      {
        expectedPath: "sample_fetches.hdr.in_type",
        mutate: (data) => {
          (data.sample_fetches as Record<string, Record<string, unknown>>).hdr.in_type = 1;
        },
      },
      {
        expectedPath: "sample_fetches.hdr.min_args",
        mutate: (data) => {
          (data.sample_fetches as Record<string, Record<string, unknown>>).hdr.min_args = "0";
        },
      },
      {
        expectedPath: "sample_fetches.hdr.deprecated",
        mutate: (data) => {
          (data.sample_fetches as Record<string, Record<string, unknown>>).hdr.deprecated = "no";
        },
      },
      {
        expectedPath: "statement_rules.0.fixed_slots",
        mutate: (data) => {
          (data.statement_rules as Array<Record<string, unknown>>)[0].fixed_slots = "address";
        },
      },
    ];

    for (const { expectedPath, mutate } of cases) {
      expectMalformedGeneratedMetadata(expectedPath, mutate);
    }
  });

  it("rejects malformed sample_casts metadata", () => {
    const cases: Array<{
      expectedPath: string;
      mutate: (data: Record<string, unknown>) => void;
    }> = [
      {
        expectedPath: "sample_casts",
        mutate: (data) => {
          data.sample_casts = {};
        },
      },
      {
        expectedPath: "sample_casts.0",
        mutate: (data) => {
          data.sample_casts = ["yes"];
        },
      },
      {
        expectedPath: "sample_casts.1",
        mutate: (data) => {
          (data.sample_casts as unknown[][])[1] = [true, "yes"];
        },
      },
    ];

    for (const { expectedPath, mutate } of cases) {
      expectMalformedGeneratedMetadata(expectedPath, mutate);
    }
  });

  it("rejects malformed address_policies entries", () => {
    const cases: Array<{
      expectedPath: string;
      mutate: (data: Record<string, unknown>) => void;
    }> = [
      {
        expectedPath: "address_policies.bind.portMandatory",
        mutate: (data) => {
          (data.address_policies as Record<string, Record<string, unknown>>).bind.portMandatory =
            null;
        },
      },
      {
        expectedPath: "address_policies.bind.portOffset",
        mutate: (data) => {
          delete (data.address_policies as Record<string, Record<string, unknown>>).bind.portOffset;
        },
      },
    ];

    for (const { expectedPath, mutate } of cases) {
      expectMalformedGeneratedMetadata(expectedPath, mutate);
    }
  });

  it("rejects malformed keyword_group_contexts metadata", () => {
    const cases: Array<{
      expectedPath: string;
      mutate: (data: Record<string, unknown>) => void;
    }> = [
      {
        expectedPath: "keyword_group_contexts",
        mutate: (data) => {
          data.keyword_group_contexts = null;
        },
      },
      {
        expectedPath: "keyword_group_contexts.bind_options.ssl",
        mutate: (data) => {
          (
            data.keyword_group_contexts as Record<string, Record<string, unknown>>
          ).bind_options.ssl = ["bind", 1];
        },
      },
    ];

    for (const { expectedPath, mutate } of cases) {
      expectMalformedGeneratedMetadata(expectedPath, mutate);
    }
  });

  it("keeps absent keyword_group_contexts default behavior", () => {
    const data = structuredClone(validGeneratedSchemaFixture());
    delete data.keyword_group_contexts;
    const fixture = createTempSchemaFixture("haproxy-absent-keyword-group-contexts-", {
      "haproxy-3.4.schema.json": JSON.stringify(data),
    });
    try {
      clearSchemaCache();
      const schema = loadSchema({ extensionPath: fixture.extensionPath } as never, "3.4");
      expect(schema.keyword_group_contexts).toEqual({});
    } finally {
      fixture.cleanup();
    }
  });

  it("accepts line_layout with only required optional fields", () => {
    const data = structuredClone(validGeneratedSchemaFixture());
    data.line_layout = { prefix_families: ["stats"] };
    const fixture = createTempSchemaFixture("haproxy-minimal-line-layout-", {
      "haproxy-3.4.schema.json": JSON.stringify(data),
    });
    try {
      clearSchemaCache();
      const loaded = loadSchema({ extensionPath: fixture.extensionPath } as never, "3.4");
      expect(loaded.line_layout?.prefix_families).toEqual(["stats"]);
    } finally {
      fixture.cleanup();
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

  it("sectionHeaderSet unions line_layout headers with schema sections", () => {
    const schema = loadFixtureSchema("3.4");
    expect(sectionHeaderSet(schema).has("fcgi-app")).toBe(true);
    const custom = structuredClone(schema);
    custom.line_layout = { section_headers: ["custom-proxy"] };
    expect(sectionHeaderSet(custom).has("custom-proxy")).toBe(true);
    expect(sectionHeaderSet(custom).has("global")).toBe(true);
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

  it("covers statement rule and section option keyword branches", () => {
    const bare = {
      ...structuredClone(schema),
      statement_rules: undefined,
    } as unknown as typeof schema;
    expect(hasStatementRuleKind(bare, "directive")).toBe(false);
    expect(statementRuleKinds(bare)).toEqual(new Set());
    expect(statementRuleGroupForKind(bare, "bind")).toBeNull();

    const withUngroupedRule = structuredClone(schema);
    withUngroupedRule.statement_rules = [
      ...(withUngroupedRule.statement_rules ?? []),
      {
        kind: "__test_kind__",
        keyword: "__test_kind__",
        match_tokens: ["__test_kind__"],
        sections: [],
      },
    ];
    expect(statementRuleGroupForKind(withUngroupedRule, "__test_kind__")).toBeNull();

    const invalidOption = structuredClone(schema);
    invalidOption.sections = {
      ...invalidOption.sections,
      probe: { name: "probe", keywords: ["option not-in-options-group"] },
    };
    expect(sectionHasOptionKeywords(invalidOption, "probe")).toBe(false);

    const invalidNoOption = structuredClone(schema);
    invalidNoOption.sections = {
      ...invalidNoOption.sections,
      probe2: { name: "probe2", keywords: ["no option not-in-options-group"] },
    };
    expect(sectionHasOptionKeywords(invalidNoOption, "probe2")).toBe(false);

    const logFormatBare = structuredClone(schema);
    logFormatBare.logformat_slots = [{}, { directive: "host" }] as never;
    expect(logFormatDirectiveKeywordSet(logFormatBare).has("host")).toBe(true);

    const noLogFormatSlots = structuredClone(schema);
    noLogFormatSlots.logformat_slots = undefined;
    expect(logFormatDirectiveKeywordSet(noLogFormatSlots).size).toBe(0);
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
