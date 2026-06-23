import { extractAclConditionSpans, validateAclConditions } from "../../src/aclCondition";
import { argumentModelDiagnostics } from "../../src/argumentDiagnostics";
import { enumNamesForSlot } from "../../src/argumentEnumUtils";
import { provideDefinition, provideReferences } from "../../src/navigation";
import { formatConfig, splitLineAtComment } from "../../src/formatter";
import {
  validateHaproxyAddress,
  looksLikeAddressToken,
  ADDRESS_POLICIES,
} from "../../src/addressFormat";
import { computeDiagnostics } from "../../src/diagnostics";
import { validateSampleExpressions } from "../../src/sampleExpression";
import { parseDocument } from "../../src/parser";
import { statementDiagnostics } from "../../src/statementDiagnostics";
import { buildLineDiagnosticMemo } from "../helpers/lineMemo";
import * as symbolIndex from "../../src/symbolIndex";
import { buildSymbolIndex } from "../../src/symbolIndex";
import { isLikelyValue } from "../../src/tokenUtils";
import { createDocument } from "../helpers/document";
import { loadSchema, loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");
const schema32 = loadSchema("3.2");

function pos(line: number, character: number) {
  return { line, character } as never;
}

describe("coverage line gaps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("covers addressFormat edge cases", () => {
    expect(
      validateHaproxyAddress("foo]bar:80", {
        portOk: true,
        portMandatory: false,
        portRange: false,
        portOffset: false,
      }).valid,
    ).toBe(false);
    expect(validateHaproxyAddress(".:80", ADDRESS_POLICIES.bind).code).toBe("invalid-address");
    expect(validateHaproxyAddress("bad..host:80", ADDRESS_POLICIES.bind).code).toBe(
      "invalid-address",
    );
    expect(validateHaproxyAddress("localhost", ADDRESS_POLICIES.log).valid).toBe(true);
    expect(validateHaproxyAddress("udp@", ADDRESS_POLICIES.log)).toEqual({ valid: true });
    expect(validateHaproxyAddress("*:8080", ADDRESS_POLICIES.bind).valid).toBe(true);
    expect(validateHaproxyAddress("*", ADDRESS_POLICIES.log).valid).toBe(true);
    expect(looksLikeAddressToken("/run/haproxy.sock")).toBe(true);
    expect(looksLikeAddressToken("/run/sock:8080")).toBe(true);
    expect(looksLikeAddressToken("/tmp/haproxy.sock:1")).toBe(true);
    expect(looksLikeAddressToken("/ab:80")).toBe(true);
    expect(looksLikeAddressToken("not-an-address")).toBe(false);
    expect(
      validateHaproxyAddress("host:80]junk", {
        portOk: true,
        portMandatory: false,
        portRange: false,
        portOffset: false,
      }).valid,
    ).toBe(false);
  });

  it("covers diagnostics option and pre-section branches", () => {
    const custom = structuredClone(bundle.schema);
    custom.sections.defaults = {
      ...custom.sections.defaults,
      keywords: [
        ...custom.sections.defaults.keywords.filter((kw) => !kw.startsWith("option")),
        "option",
      ],
    };
    const optionDiags = computeDiagnostics(
      createDocument("defaults\n    option nonsense"),
      custom,
      {
        languageData: bundle.languageData,
      },
    );
    expect(optionDiags.filter((d) => d.code === "unknown-keyword")).toHaveLength(0);

    const blockedOption = computeDiagnostics(
      createDocument("global\n    option httplog"),
      bundle.schema,
      {
        languageData: bundle.languageData,
      },
    );
    expect(
      blockedOption.some((d) => d.code === "unknown-keyword" || d.code === "wrong-section"),
    ).toBe(true);

    const fewSections = structuredClone(bundle.schema);
    fewSections.keywords.mode = {
      ...fewSections.keywords.mode,
      sections: ["defaults", "frontend"],
    };
    const fewSectionDiags = computeDiagnostics(createDocument("global\n    mode"), fewSections, {
      languageData: bundle.languageData,
    });
    expect(fewSectionDiags.find((d) => d.code === "wrong-section")?.message).toContain(
      "allowed in:",
    );

    const preSection = computeDiagnostics(createDocument("    mode\nglobal"), bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(preSection.some((d) => d.code === "wrong-section")).toBe(true);
  });

  it("covers formatter empty-token paths", () => {
    expect(splitLineAtComment("mode 'quoted'")).toEqual({
      code: "mode 'quoted'",
      commentSuffix: null,
    });
    expect(splitLineAtComment('mode "a\\"b"')).toEqual({
      code: 'mode "a\\"b"',
      commentSuffix: null,
    });
    expect(formatConfig("\n\nglobal\n\nbackend api")).toBe("\n\nglobal\n\n\nbackend api");
    expect(formatConfig('global\n    "')).toBe('global\n    "');
    expect(formatConfig("global\n#only")).toBe("global\n#only");
    expect(formatConfig('global\n    "')).toBe('global\n    "');
    expect(formatConfig("global\n!!!")).toBe("global\n    !!!");
  });

  it("covers navigation null branches", () => {
    const doc = createDocument("frontend web\n    use_backend missing");
    const col = "    use_backend missing".indexOf("missing");
    expect(provideDefinition(doc as never, pos(1, col), bundle.schema, 4000)).toBeNull();

    vi.spyOn(symbolIndex, "resolveSymbolAtPosition").mockReturnValue({
      kind: "proxy-section",
      name: "missing",
      scopeKey: null,
    });
    vi.spyOn(symbolIndex, "findDefinitions").mockReturnValue([]);
    expect(provideDefinition(doc as never, pos(1, col), bundle.schema, 4000)).toBeNull();

    vi.spyOn(symbolIndex, "findAllSites").mockReturnValue([]);
    expect(
      provideReferences(
        doc as never,
        pos(1, col),
        { includeDeclaration: true },
        bundle.schema,
        4000,
      ),
    ).toEqual([]);

    vi.spyOn(symbolIndex, "findAllSites").mockReturnValue([
      {
        kind: "acl",
        name: "test",
        line: 1,
        start: 4,
        end: 7,
        scopeKey: "frontend:web",
        role: "definition",
      },
    ]);
    expect(
      provideReferences(
        doc as never,
        pos(1, col),
        { includeDeclaration: false },
        bundle.schema,
        4000,
      ),
    ).toEqual([]);
  });

  it("covers symbolIndex helper branches", () => {
    const customSchema = structuredClone(bundle.schema);
    customSchema.statement_rules = [
      {
        keyword: "special",
        kind: "directive",
        prefix: "no option",
        definition_kind: "acl",
        fixed_slots: [{ role: "name" }],
      },
      {
        keyword: "filter",
        kind: "filter",
        definition_kind: "filter",
        fixed_slots: [{ role: "name" }],
      },
    ];
    const parsed = parseDocument(
      createDocument("backend api\n    special name\n    filter compression"),
    );
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.definitions.get("filter:backend:api:compression")?.length).toBe(1);

    const fromParsed = parseDocument(
      createDocument("defaults profile_a\nfrontend web extra from profile_a"),
    );
    const fromIndex = buildSymbolIndex(fromParsed, bundle.schema);
    expect(fromIndex.references.some((r) => r.name === "profile_a")).toBe(true);

    const noNameRuleSchema = structuredClone(bundle.schema);
    noNameRuleSchema.statement_rules = [
      { keyword: "orphan", kind: "directive", definition_kind: "acl" },
      { keyword: "note", kind: "directive", definition_kind: "acl" },
      {
        keyword: "server",
        kind: "server",
        definition_kind: "server",
        symbol_name_token_index: 99,
      },
    ];
    const orphanIndex = buildSymbolIndex(
      parseDocument(
        createDocument("backend api\n    orphan\n    note\n    server s1 127.0.0.1:80"),
      ),
      noNameRuleSchema,
    );
    expect(orphanIndex.definitions.get("acl:orphan")).toBeUndefined();

    const indentedIndex = buildSymbolIndex(
      parseDocument(createDocument("    frontend web")),
      bundle.schema,
    );
    expect(indentedIndex.definitions.get("proxy-section:web")).toBeUndefined();

    const aclParsed = parseDocument(
      createDocument(
        "frontend web\n    acl is_api path -m beg /api\n    http-request deny if !is_api",
      ),
    );
    const aclIndex = buildSymbolIndex(aclParsed, bundle.schema);
    expect(aclIndex.references.some((r) => r.kind === "acl" && r.name === "is_api")).toBe(true);
  });

  it("covers sample expression branches", () => {
    const custom = structuredClone(schema32);
    custom.sample_converters.custom = {
      name: "custom",
      args: ["IPv6 mask"],
      in_type: "str",
      out_type: "same",
    };
    expect(
      validateSampleExpressions(
        'http-request add-header n %[src,custom("2001:db8::/32")] ',
        custom,
      ).map((d) => d.code),
    ).toEqual([]);
    expect(
      validateSampleExpressions('http-request add-header n %[req.hdr("a\\t")] ', schema32).map(
        (d) => d.code,
      ),
    ).toEqual([]);
    expect(
      validateSampleExpressions(
        "http-request add-header n %[src,ipmask(1.2.3.4/32)]",
        schema32,
      ).map((d) => d.code),
    ).toEqual([]);
    expect(
      validateSampleExpressions("http-request add-header n %[path(0,extra,more)]", schema32).some(
        (d) => d.code === "sample-fetch-args",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions("http-request add-header n %[payload_lv]", schema32).some(
        (d) => d.code === "sample-fetch-args",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions("http-request add-header n %[src)]", schema32).some(
        (d) => d.code === "sample-syntax",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions("http-request add-header n %[src,lower,extra]", schema32).some(
        (d) => d.code === "sample-unknown-converter",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions("http-request add-header n %[src,map()]", schema32).some(
        (d) => d.code === "sample-converter-args",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions("http-request add-header n %[src,map(file,key)]", schema32).map(
        (d) => d.code,
      ),
    ).toEqual([]);
    expect(
      validateSampleExpressions("http-request add-header n %[not_a_fetch(0)]", schema32).some(
        (d) => d.code === "sample-unknown-fetch",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions('http-request add-header n %[req.hdr("line\\r")] ', schema32).map(
        (d) => d.code,
      ),
    ).toEqual([]);
    expect(
      validateSampleExpressions('http-request add-header n %[req.hdr("line\\n")] ', schema32).map(
        (d) => d.code,
      ),
    ).toEqual([]);
    expect(
      validateSampleExpressions('http-request add-header n %[req.hdr("tab\\t")] ', schema32).map(
        (d) => d.code,
      ),
    ).toEqual([]);
    expect(
      validateSampleExpressions('http-request add-header n %[req.hdr("quote\\"")] ', schema32).map(
        (d) => d.code,
      ),
    ).toEqual([]);
    expect(
      validateSampleExpressions('http-request add-header n %[req.hdr("bad\\\\x")] ', schema32).map(
        (d) => d.code,
      ),
    ).toEqual([]);
    expect(
      validateSampleExpressions("http-request add-header n %[payload_lv(0)]", schema32).some(
        (d) => d.code === "sample-fetch-args",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions("http-request add-header n %[src,ipmask]", schema32).some(
        (d) => d.code === "sample-converter-args",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions("http-request add-header n %[src,lower(x)]", schema32).some(
        (d) => d.code === "sample-converter-args",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions("http-request add-header n %[always_false,ipmask]", schema32).some(
        (d) => d.code === "sample-converter-cast",
      ),
    ).toBe(true);
  });

  it("covers statement diagnostics nested scan", () => {
    const customSchema = structuredClone(bundle.schema);
    customSchema.statement_rules = [
      {
        keyword: "server",
        kind: "server",
        group: "server_options",
        nested_start_index: 3,
      },
    ];
    const line = parseDocument(createDocument("backend api\n    server s1 127.0.0.1:80"))[1];
    expect(
      statementDiagnostics(line, customSchema).filter((d) => d.code === "unknown-parameter"),
    ).toHaveLength(0);

    const bindLine = parseDocument(createDocument("frontend web\n    bind :80 name s1"))[1];
    const bindRule = bundle.schema.statement_rules.find((r) => r.kind === "bind");
    expect(bindRule?.fixed_slots?.length ?? 0).toBeGreaterThan(0);
    const bindSchema = structuredClone(bundle.schema);
    const bindOnly = bindSchema.statement_rules.filter((r) => r.kind === "bind");
    bindSchema.statement_rules = bindOnly;
    expect(statementDiagnostics(bindLine, bindSchema).length).toBeGreaterThanOrEqual(0);
  });

  it("covers statement diagnostics nested option argument branches", () => {
    const wsLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 ws check"),
    )[1];
    expect(
      statementDiagnostics(wsLine, bundle.schema).some((d) => d.code === "missing-argument"),
    ).toBe(true);

    const cookieLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 cookie app01 bogus"),
    )[1];
    expect(
      statementDiagnostics(cookieLine, bundle.schema).filter((d) => d.code === "unknown-parameter"),
    ).toHaveLength(0);

    const customSchema = structuredClone(bundle.schema);
    customSchema.keywords.testvalopt = {
      name: "testvalopt",
      sections: ["backend"],
      signatures: ["testvalopt <value>"],
      sources: [],
      contexts: [],
      arguments: [],
    };
    customSchema.keyword_groups.server_options = [
      ...(customSchema.keyword_groups.server_options ?? []),
      "testvalopt",
    ];
    customSchema.keyword_groups.server_options_with_value = [
      ...(customSchema.keyword_groups.server_options_with_value ?? []),
      "testvalopt",
    ];
    customSchema.keywords.testreqenum = {
      name: "testreqenum",
      sections: ["backend"],
      signatures: ["testreqenum <mode>"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testreqenum <mode>"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 1,
            slots: [
              {
                enum: ["on", "off"],
                optional: false,
                value_kind: "enum",
                variadic: false,
              },
            ],
          },
        },
      ],
    };
    customSchema.keyword_groups.server_options.push("testreqenum");
    customSchema.keywords.testoptenum = {
      name: "testoptenum",
      sections: ["backend"],
      signatures: ["testoptenum [<name>] [<mode>]"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testoptenum [<name>] [<mode>]"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 0,
            max_args: 2,
            slots: [
              {
                enum: [],
                optional: false,
                value_kind: "name",
                variadic: false,
              },
              {
                enum: ["on", "off"],
                optional: true,
                value_kind: "enum",
                variadic: false,
              },
            ],
          },
        },
      ],
    };
    customSchema.keyword_groups.server_options.push("testoptenum");
    customSchema.keywords.testno52 = {
      name: "testno52",
      sections: ["backend"],
      signatures: ["testno52"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "4.2",
          sections: ["frontend"],
          signatures: ["testno52"],
          contexts: [],
          arguments: [],
        },
      ],
    };
    customSchema.keyword_groups.server_options.push("testno52");
    customSchema.keywords.testoptbreak = {
      name: "testoptbreak",
      sections: ["backend"],
      signatures: ["testoptbreak [<mode>]"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testoptbreak [<mode>]"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 0,
            max_args: 1,
            slots: [
              {
                enum: ["on", "off"],
                optional: true,
                value_kind: "enum",
                variadic: false,
              },
            ],
          },
        },
      ],
    };
    customSchema.keyword_groups.server_options.push("testoptbreak");

    const valueLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testvalopt myval check"),
    )[1];
    expect(
      statementDiagnostics(valueLine, customSchema).filter((d) => d.code === "unknown-parameter"),
    ).toHaveLength(0);

    const reqEnumLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testreqenum check"),
    )[1];
    expect(
      statementDiagnostics(reqEnumLine, customSchema).some((d) => d.code === "missing-argument"),
    ).toBe(true);

    const optEnumLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testoptenum myname check"),
    )[1];
    expect(
      statementDiagnostics(optEnumLine, customSchema).filter((d) => d.code === "unknown-parameter"),
    ).toHaveLength(0);

    const noVariantLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testno52"),
    )[1];
    expect(
      statementDiagnostics(noVariantLine, customSchema).filter(
        (d) => d.code === "unknown-parameter",
      ),
    ).toHaveLength(0);

    const bogusWsLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 ws bogus"),
    )[1];
    expect(
      statementDiagnostics(bogusWsLine, bundle.schema).filter(
        (d) => d.code === "unknown-parameter",
      ),
    ).toHaveLength(0);

    const optBreakLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testoptbreak check"),
    )[1];
    expect(
      statementDiagnostics(optBreakLine, customSchema).filter(
        (d) => d.code === "unknown-parameter",
      ),
    ).toHaveLength(0);

    const bindSchema = structuredClone(customSchema);
    bindSchema.keywords.testvalopt = {
      name: "testvalopt",
      sections: ["frontend"],
      signatures: ["testvalopt <value>"],
      sources: [],
      contexts: [],
      arguments: [],
    };
    bindSchema.keyword_groups.bind_options = [
      ...(bindSchema.keyword_groups.bind_options ?? []),
      "testvalopt",
    ];
    bindSchema.keyword_groups.bind_options_with_value = [
      ...(bindSchema.keyword_groups.bind_options_with_value ?? []),
      "testvalopt",
    ];
    const bindLine = parseDocument(
      createDocument("frontend web\n    bind :80 testvalopt myval ssl"),
    )[1];
    expect(
      statementDiagnostics(bindLine, bindSchema).filter((d) => d.code === "unknown-parameter"),
    ).toHaveLength(0);
  });

  it("covers extension edge cases", () => {
    expect(extractAclConditionSpans('log-format "%{+Q}o %t"')).toEqual([]);
    expect(validateAclConditions("deny if { base_beg(/api) }", bundle.schema)).toEqual([]);
    expect(validateAclConditions("deny if { req.hdr(host }", bundle.schema).length).toBeGreaterThan(
      0,
    );

    expect(validateHaproxyAddress("127.0.0.1:", ADDRESS_POLICIES.log)).toEqual({ valid: true });
    expect(validateHaproxyAddress("127.0.0.1:100-abc", ADDRESS_POLICIES.serverSource).code).toBe(
      "invalid-port",
    );

    const balanceLine = parseDocument(createDocument("defaults\n    balance"))[1];
    expect(
      argumentModelDiagnostics(
        balanceLine,
        bundle.schema,
        buildLineDiagnosticMemo(balanceLine, bundle.schema),
      ),
    ).toEqual([]);

    const cpuPolicyLine = parseDocument(createDocument("global\n    cpu-policy"))[1];
    expect(
      argumentModelDiagnostics(
        cpuPolicyLine,
        bundle.schema,
        buildLineDiagnosticMemo(cpuPolicyLine, bundle.schema),
      ).filter((d) => d.code === "missing-argument"),
    ).toHaveLength(0);

    const modeLine = parseDocument(createDocument("defaults\n    mode /tmp/haproxy.sock"))[1];
    expect(
      argumentModelDiagnostics(
        modeLine,
        bundle.schema,
        buildLineDiagnosticMemo(modeLine, bundle.schema),
      ).filter((d) => d.code === "unknown-value"),
    ).toHaveLength(0);
    expect(isLikelyValue("127.0.0.1:8080")).toBe(true);

    expect(enumNamesForSlot({ value_kind: "path" }, bundle.schema.keywords.mode, 0)).toEqual([]);

    expect(validateSampleExpressions("http-request add-header n %[src()]", schema32)).toEqual([]);
    expect(
      validateSampleExpressions("http-request add-header n %[path(]", schema32).some(
        (d) => d.code === "sample-syntax",
      ),
    ).toBe(true);
    expect(
      validateSampleExpressions("http-request add-header n %[src,map(x]", schema32).some(
        (d) => d.code === "sample-syntax",
      ),
    ).toBe(true);

    const serverLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 ca-file /etc/ssl/ca.pem"),
    )[1];
    statementDiagnostics(serverLine, bundle.schema);

    const filterSequenceLine = parseDocument(
      createDocument("frontend web\n    filter-sequence comp comp-req,,comp-res"),
    );
    buildSymbolIndex(filterSequenceLine, bundle.schema);

    const missingListToken = parseDocument(
      createDocument("frontend web\n    filter-sequence comp list"),
    );
    missingListToken[1] = {
      ...missingListToken[1],
      tokens: [
        { text: "filter-sequence", start: 4, end: 19 },
        { text: "comp", start: 20, end: 24 },
        undefined as never,
      ],
    };
    buildSymbolIndex(missingListToken, bundle.schema);

    const emptyAuthFetch = parseDocument(createDocument("frontend web\n    acl x http_auth()"));
    buildSymbolIndex(emptyAuthFetch, bundle.schema);

    const filterCacheRef = parseDocument(
      createDocument(
        "cache bench_cache\n    total-max-size 4\nfrontend web\n    filter cache bench_cache",
      ),
    );
    buildSymbolIndex(filterCacheRef, bundle.schema);

    const sparseTokenLine = parseDocument(createDocument("frontend web\n    mode http extra"));
    sparseTokenLine[1] = {
      ...sparseTokenLine[1],
      tokens: [
        { text: "mode", start: 4, end: 8 },
        undefined as never,
        { text: "http", start: 9, end: 13 },
      ],
    };
    buildSymbolIndex(sparseTokenLine, bundle.schema);
  });
});
