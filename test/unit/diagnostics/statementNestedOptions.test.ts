import * as addressFormat from "../../../src/diagnostics/addressFormat";
import { parseDocument } from "../../helpers/parse";
import { statementDiagnostics } from "../../../src/diagnostics/statementDiagnostics";
import { createDocument } from "../../helpers/document";

import { lineDiag, bundle } from "./statementHelpers";

describe("statementDiagnostics nested options", () => {
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

  it("consumes raw trailing arguments for enum-style nested keywords", () => {
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
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testrequiresvalue on raw"),
    )[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("skips optional keyword/value nested option pairs as a unit", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.testoptionalpair = {
      name: "testoptionalpair",
      sections: ["backend"],
      signatures: ["testoptionalpair [via <value>] later"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testoptionalpair [via <value>] later"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 3,
            slots: [
              { enum: ["via"], optional: true, value_kind: "enum", variadic: false },
              { enum: [], optional: true, value_kind: "name", variadic: false },
              { enum: ["later"], optional: false, value_kind: "enum", variadic: false },
            ],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testoptionalpair",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testoptionalpair later"),
    )[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
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

  it("skips address diagnostics when validation returns no message", () => {
    const spy = vi.spyOn(addressFormat, "validateHaproxyAddress").mockReturnValue({
      valid: false,
    });
    expect(lineDiag("global\n    log bad local0", 1)).toEqual([]);
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

  it("consumes plain values for value-taking bind options without argument models", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_groups.bind_options = [
      ...(schema.keyword_groups.bind_options ?? []),
      "testvalueonly",
    ];
    schema.keyword_groups.bind_options_with_value = [
      ...(schema.keyword_groups.bind_options_with_value ?? []),
      "testvalueonly",
    ];
    const line = parseDocument(createDocument("frontend web\n    bind :80 testvalueonly value"))[1];
    expect(
      statementDiagnostics(line, schema).filter((d) => d.code === "unknown-parameter"),
    ).toHaveLength(0);
  });

  it("validates fixed slots when nested_start_index is absent", () => {
    const schema = structuredClone(bundle.schema);
    const serverRule = schema.statement_rules.find((r) => r.keyword === "server");
    if (!serverRule) {
      throw new Error("expected server statement rule");
    }
    schema.statement_rules = [
      {
        ...serverRule,
        nested_start_index: undefined,
      },
    ];
    const line = parseDocument(createDocument("backend api\n    server s1 bad-address:80"))[1];
    expect(statementDiagnostics(line, schema).some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("accepts enum keywords that do not require trailing arguments", () => {
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
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testplainenum",
      "check",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testplainenum on check"),
    )[1];
    expect(statementDiagnostics(line, schema).filter((d) => d.code === "missing-argument")).toEqual(
      [],
    );
  });

  it("scans nested options for non-server statement kinds without value catalogs", () => {
    const schema = structuredClone(bundle.schema);
    schema.statement_rules = [
      {
        keyword: "custom",
        kind: "custom",
        group: "server_options",
        nested_start_index: 1,
        fixed_slots: [],
      },
    ];
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testnoval",
      "inter",
    ];
    const line = parseDocument(createDocument("backend api\n    custom testnoval inter 2s"))[1];
    expect(
      statementDiagnostics(line, schema).filter((d) => d.code === "unknown-parameter"),
    ).toEqual([]);
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

  it("does not consume another option as a plain value-taking argument", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testvalueonly",
      "nextopt",
    ];
    schema.keyword_groups.server_options_with_value = [
      ...(schema.keyword_groups.server_options_with_value ?? []),
      "testvalueonly",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testvalueonly nextopt"),
    )[1];
    expect(
      statementDiagnostics(line, schema).filter((d) => d.code === "unknown-parameter"),
    ).toHaveLength(0);
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
