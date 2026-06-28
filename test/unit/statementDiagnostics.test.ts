import { computeDiagnostics } from "../../src/diagnostics";
import { parseDocument } from "../../src/parser";
import { statementDiagnostics } from "../../src/statementDiagnostics";
import * as addressFormat from "../../src/addressFormat";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");

function lineDiag(content: string, lineNo: number) {
  const doc = createDocument(content);
  const line = parseDocument(doc)[lineNo];
  return statementDiagnostics(line, bundle.schema);
}

describe("statementDiagnostics", () => {
  it("validates log target addresses", () => {
    const diags = lineDiag("global\n    log not-an-address local0", 1);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("skips known log targets", () => {
    expect(lineDiag("global\n    log stdout local0", 1)).toEqual([]);
    expect(lineDiag("global\n    log @log local0", 1)).toEqual([]);
    expect(lineDiag("global\n    log ring@buffer local0", 1)).toEqual([]);
    expect(lineDiag("global\n    log /var/log/haproxy.log local0", 1)).toEqual([]);
  });

  it("validates source addresses", () => {
    const diags = lineDiag("defaults\n    source not-an-address", 1);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("validates tcp-check and http-check addr parameters", () => {
    const tcp = lineDiag("backend api\n    tcp-check connect addr bad", 1);
    expect(tcp.some((d) => d.code === "invalid-address")).toBe(true);
    const http = lineDiag("backend api\n    http-check connect addr bad", 1);
    expect(http.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("reports missing server arguments and reserved names", () => {
    const missing = lineDiag("backend api\n    server s1", 1);
    expect(missing.some((d) => d.code === "missing-argument")).toBe(true);

    const reserved = lineDiag("backend api\n    server check 127.0.0.1:80", 1);
    expect(reserved.some((d) => d.code === "reserved-name")).toBe(true);
  });

  it("reports unknown server parameters", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 notreal", 1);
    expect(diags.some((d) => d.code === "unknown-parameter")).toBe(true);
  });

  it("validates server option address values", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 source bad", 1);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("consumes nested source sub-options on server lines", () => {
    const diags = lineDiag(
      "backend api\n    server s1 127.0.0.1:80 check source 0.0.0.0 interface eth0",
      1,
    );
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("reports missing nested source sub-option argument", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 source 0.0.0.0 interface", 1);
    expect(diags.some((d) => d.code === "missing-argument")).toBe(true);
  });

  it("is invoked from computeDiagnostics for server lines", () => {
    const doc = createDocument("backend api\n    server s1 127.0.0.1:80 notreal");
    const diags = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(diags.some((d) => d.code === "unknown-parameter")).toBe(true);
  });

  it("returns empty for unrelated directives", () => {
    expect(lineDiag("defaults\n    mode http", 1)).toEqual([]);
    expect(lineDiag("global\n    daemon", 1)).toEqual([]);
  });

  it("validates bind addresses and unix sockets", () => {
    const bad = lineDiag("frontend web\n    bind bad-address:80", 1);
    expect(bad.some((d) => d.code === "invalid-address")).toBe(true);
    const unix = lineDiag("frontend web\n    bind /tmp/haproxy.sock", 1);
    expect(unix.filter((d) => d.code === "invalid-address")).toHaveLength(0);
  });

  it("consumes repeated bind addresses before scanning bind options", () => {
    const diags = lineDiag("frontend web\n    bind 192.168.1.22:80, :81, 192.168.1.23:82 ssl", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("skips placeholder server addresses", () => {
    const diags = lineDiag("backend api\n    server s1 /var/run/app.sock", 1);
    expect(diags.filter((d) => d.code === "invalid-address")).toHaveLength(0);
  });

  it("ignores numeric server options in nested scan", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 inter 2s", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("accepts server verify values", () => {
    const plain = lineDiag(
      "backend api\n    server s1 10.0.0.0:9006 check inter 1s verify none",
      1,
    );
    const ssl = lineDiag(
      "backend api\n    server s1 127.0.0.1:9001 check inter 1s ssl verify none",
      1,
    );
    expect(plain.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
    expect(ssl.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("accepts server cookie values", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 cookie app01 check", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("returns empty for incomplete log and source lines", () => {
    expect(lineDiag("global\n    log", 1)).toEqual([]);
    expect(lineDiag("defaults\n    source", 1)).toEqual([]);
    expect(lineDiag("backend api\n    tcp-check connect", 1)).toEqual([]);
  });

  it("returns empty for lines without statement rules", () => {
    expect(lineDiag("global\n    # comment", 1)).toEqual([]);
  });

  it("skips empty nested option tokens", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80  inter 2s", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("validates server addresses using kind fallback without address_policy", () => {
    const schema = structuredClone(bundle.schema);
    const serverRule = schema.statement_rules.find((r) => r.keyword === "server");
    const addressSlot = serverRule?.fixed_slots?.find((s) => s.role === "address");
    if (addressSlot) {
      delete addressSlot.address_policy;
    }
    const line = parseDocument(createDocument("backend api\n    server s1 bad-address:80"))[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("validates bind addresses using kind fallback without address_policy", () => {
    const schema = structuredClone(bundle.schema);
    const bindRule = schema.statement_rules.find((r) => r.keyword === "bind");
    if (bindRule?.fixed_slots) {
      for (const slot of bindRule.fixed_slots) {
        delete slot.address_policy;
      }
    }
    const line = parseDocument(createDocument("frontend web\n    bind bad-address:80"))[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("returns empty for rules without option groups", () => {
    const schema = structuredClone(bundle.schema);
    schema.statement_rules = [
      {
        keyword: "custom",
        kind: "directive",
        fixed_slots: [{ role: "name" }],
        nested_start_index: 2,
      },
    ];
    const doc = createDocument("backend api\n    custom name");
    const line = parseDocument(doc)[1];
    expect(statementDiagnostics(line, schema)).toEqual([]);
  });

  it("scans nested options for option-only rules like default-server", () => {
    const diags = lineDiag("backend api\n    default-server source 0.0.0.0 interface eth0", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("does not consume the next option as a value for value-taking nested options", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 cookie check", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
  });

  it("reports missing trailing arguments for enum-style nested keywords", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.testrequiresvalue = {
      name: "testrequiresvalue",
      sections: ["backend"],
      signatures: ["testrequiresvalue on <value>"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testrequiresvalue on <value>"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 1,
            slots: [
              {
                enum: ["on"],
                optional: false,
                value_kind: "enum",
                variadic: false,
              },
            ],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testrequiresvalue",
      "testnextoption",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testrequiresvalue on testnextoption"),
    )[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.some((d) => d.code === "missing-argument")).toBe(true);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("uses bind chapter variants for nested bind options", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.testbindvariant = {
      name: "testbindvariant",
      sections: ["frontend"],
      signatures: ["testbindvariant"],
      sources: [],
      contexts: [],
      arguments: [{ parameter: "base", description: "base", values: [] }],
      argument_model: {
        min_args: 0,
        max_args: 0,
        slots: [],
      },
      variants: [
        {
          chapter: "5.1",
          sections: ["frontend"],
          signatures: ["testbindvariant <value>"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 1,
            slots: [{ enum: [], optional: false, value_kind: "name", variadic: false }],
          },
        },
      ],
    };
    schema.keyword_groups.bind_options = [
      ...(schema.keyword_groups.bind_options ?? []),
      "testbindvariant",
    ];
    const diags = parseDocument(createDocument("frontend web\n    bind :80 testbindvariant"))[1];
    expect(statementDiagnostics(diags, schema).some((d) => d.code === "missing-argument")).toBe(
      true,
    );
  });

  it("falls back to invalid-address when address validation omits a code", () => {
    const spy = vi.spyOn(addressFormat, "validateHaproxyAddress").mockReturnValue({
      valid: false,
      message: "broken",
    });
    const diags = lineDiag("global\n    log bad local0", 1);
    expect(diags.find((d) => d.code === "invalid-address")?.message).toBe("broken");
    spy.mockRestore();
  });

  it("accepts a single nested value when max args is unlimited", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.testvariadic = {
      name: "testvariadic",
      sections: ["backend"],
      signatures: ["testvariadic [<value> ...]"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testvariadic [<value> ...]"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 0,
            max_args: null,
            slots: [{ enum: [], optional: true, value_kind: "name", variadic: true }],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testvariadic",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testvariadic a"),
    )[1];
    expect(statementDiagnostics(line, schema)).toEqual([]);
  });

  it("tolerates address-valued nested options when no address policy applies", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.testaddress = {
      name: "testaddress",
      sections: ["backend"],
      signatures: ["testaddress <addr>"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testaddress <addr>"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 1,
            slots: [{ enum: [], optional: false, value_kind: "address", variadic: false }],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testaddress",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testaddress not-an-address"),
    )[1];
    expect(statementDiagnostics(line, schema).filter((d) => d.code === "invalid-address")).toEqual(
      [],
    );
  });

  it("does not consume a value for a trailing value-taking option without a following token", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testvalueonly",
    ];
    schema.keyword_groups.server_options_with_value = [
      ...(schema.keyword_groups.server_options_with_value ?? []),
      "testvalueonly",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testvalueonly"),
    )[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("consumes plain values for value-taking options without argument models", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testvalueonly",
    ];
    schema.keyword_groups.server_options_with_value = [
      ...(schema.keyword_groups.server_options_with_value ?? []),
      "testvalueonly",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testvalueonly value"),
    )[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("validates nested address options when their model is absent", () => {
    const schema = structuredClone(bundle.schema);
    if (schema.keywords.source) {
      delete schema.keywords.source.argument_model;
      for (const variant of schema.keywords.source.variants ?? []) {
        delete variant.argument_model;
      }
    }
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 source bad"),
    )[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("reports missing arguments when a required enum slot is followed by another option", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.testrequiredpair = {
      name: "testrequiredpair",
      sections: ["backend"],
      signatures: ["testrequiredpair on <value>"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testrequiredpair on <value>"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 2,
            max_args: 2,
            slots: [
              { enum: ["on"], optional: false, value_kind: "enum", variadic: false },
              { enum: [], optional: false, value_kind: "name", variadic: false },
            ],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testrequiredpair",
      "nextopt",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testrequiredpair nextopt"),
    )[1];
    expect(statementDiagnostics(line, schema).some((d) => d.code === "missing-argument")).toBe(
      true,
    );
  });

  it("covers nested option scanner edge cases directly", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.testplainenum = {
      name: "testplainenum",
      sections: ["backend"],
      signatures: ["testplainenum on"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testplainenum on"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 1,
            slots: [{ enum: ["on"], optional: false, value_kind: "enum", variadic: false }],
          },
        },
      ],
    };
    schema.keywords.testaddr = {
      name: "testaddr",
      sections: ["backend"],
      signatures: ["testaddr <addr>"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testaddr <addr>"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 1,
            slots: [{ enum: [], optional: false, value_kind: "address", variadic: false }],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testplainenum",
      "testaddr",
      "nextopt",
    ];

    const plain = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testplainenum nope"),
    )[1];
    expect(statementDiagnostics(plain, schema).some((d) => d.code === "unknown-parameter")).toBe(
      false,
    );

    const addr = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testaddr bad"),
    )[1];
    expect(statementDiagnostics(addr, schema).some((d) => d.code === "invalid-address")).toBe(
      false,
    );

    const customRule = structuredClone(schema);
    customRule.statement_rules = [
      {
        keyword: "custom",
        kind: "directive",
        fixed_slots: [],
      },
    ];
    const customLine = parseDocument(createDocument("backend api\n    custom foo"))[1];
    expect(statementDiagnostics(customLine, customRule)).toEqual([]);
  });
});
