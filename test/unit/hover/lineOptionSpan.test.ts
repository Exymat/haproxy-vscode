import { describe, expect, it } from "vitest";

import {
  buildLineOptionAllowedSet,
  computeLineOptionArgumentEnd,
  lineOptionConditionalLimit,
  resolveLineOptionStartIndex,
  resolveNestedLineOptionSpan,
} from "../../../src/language/lineOptionSpan";
import { getDocumentContext } from "../../../src/parser/documentContext";
import { parseDocument } from "../../helpers/parse";
import { createDocument } from "../../helpers/document";
import { bundles } from "./helpers";

describe("line option span helpers", () => {
  it("covers nested span resolution and bind start indexes", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    schema.keywords.parentopt = {
      name: "parentopt",
      sections: ["backend"],
      signatures: ["parentopt <value> [<childopt>]"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["parentopt <value> [<childopt>]"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 3,
            slots: [
              { enum: [], optional: false, value_kind: "generic", variadic: false },
              { enum: ["childopt"], optional: true, value_kind: "enum", variadic: false },
              { enum: [], optional: false, value_kind: "generic", variadic: false },
            ],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "parentopt",
      "childopt",
    ];
    const line = "    server s1 127.0.0.1:80 parentopt val childopt tail";
    const ctx = getDocumentContext(
      createDocument(`backend api\n${line}`),
      { line: 1, character: line.indexOf("childopt") + 3 } as never,
      schema,
    );
    if (!ctx) {
      throw new Error("expected document context");
    }
    const active = resolveNestedLineOptionSpan(schema, ctx, "server_options", 3);
    expect(active?.keyword).toBe("childopt");
    const bindRule = bundles["3.4"].schema.statement_rules.find((rule) => rule.kind === "bind");
    expect(
      resolveLineOptionStartIndex(
        schema,
        parseDocument(createDocument("frontend web\n    bind ,"))[1],
        bindRule,
      ),
    ).toBe(bindRule?.nested_start_index);
    expect(
      resolveLineOptionStartIndex(
        schema,
        parseDocument(createDocument("frontend web\n    bind :80 :443 ssl"))[1],
        bindRule,
      ),
    ).toBeGreaterThan(1);
  });

  it("covers direct line-option argument span fallbacks", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    schema.keywords.testtail = {
      name: "testtail",
      sections: ["backend"],
      signatures: ["testtail on <value> [alt]"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testtail on <value> [alt]"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 2,
            max_args: 3,
            slots: [
              { enum: ["on"], optional: false, value_kind: "enum", variadic: false },
              { enum: [], optional: false, value_kind: "name", variadic: false },
              { enum: ["alt"], optional: true, value_kind: "enum", variadic: false },
            ],
          },
        },
      ],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testtail",
      "nextopt",
    ];
    const line = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 testtail on nextopt"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        schema,
        line,
        3,
        line.tokens.length,
        "server_options",
        "server",
        "backend",
      ),
    ).toBeGreaterThan(3);
  });

  it("covers additional line-option span helpers and boundary behavior", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    schema.keyword_groups.server_options = ["flagopt"];
    schema.keyword_groups.server_options_with_value = ["valueopt"];

    const allowed = buildLineOptionAllowedSet(schema, "server_options");
    expect(allowed.allowed.has("flagopt")).toBe(true);
    expect(allowed.allowed.has("valueopt")).toBe(true);

    const parsed = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 valueopt unless cond"),
    )[1];
    expect(lineOptionConditionalLimit(parsed)).toBe(parsed.tokens.indexOf(parsed.tokens[4]));

    const bindRule = bundles["3.4"].schema.statement_rules.find((rule) => rule.kind === "bind");
    expect(resolveLineOptionStartIndex(schema, parsed, bindRule)).toBe(
      bindRule?.nested_start_index ?? -1,
    );

    const valueSchema = structuredClone(bundles["3.4"].schema);
    valueSchema.keywords.valueopt = {
      name: "valueopt",
      sections: ["backend"],
      signatures: ["valueopt <value>"],
      sources: [],
      contexts: [],
      arguments: [],
      line_option_semantics: [
        {
          parent_kind: "server",
          option_group: "server_options",
          chapter: "5.2",
          takes_value: true,
        },
      ],
    };
    valueSchema.keyword_groups.server_options = ["valueopt", "nextopt"];
    valueSchema.keyword_groups.server_options_with_value = ["valueopt"];
    const valueLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 valueopt nextopt"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        valueSchema,
        valueLine,
        3,
        valueLine.tokens.length,
        "server_options",
        "server",
        "backend",
      ),
    ).toBe(4);

    const ctx = {
      kind: "server",
      line: valueLine,
      tokenIndex: valueLine.tokens.length - 1,
    };
    expect(resolveNestedLineOptionSpan(valueSchema, ctx, "server_options", 3)?.keyword).toBe(
      "nextopt",
    );
  });
});
