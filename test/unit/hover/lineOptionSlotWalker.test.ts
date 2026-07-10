import { describe, expect, it } from "vitest";

import { computeLineOptionArgumentEnd } from "../../../src/lineOptionSpan";
import { parseDocument } from "../../helpers/parse";
import { createDocument } from "../../helpers/document";
import { bundles } from "./helpers";

describe("line option slot walker", () => {
  it("covers line-option slot walker edge cases directly", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    schema.keywords.valueopt = {
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
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "valueopt",
      "nextopt",
      "pairopt",
      "lateropt",
      "tailopt",
      "enumconsume",
      "tailonly",
      "breakopt",
      "pairskip",
    ];
    schema.keyword_groups.server_options_with_value = [
      ...(schema.keyword_groups.server_options_with_value ?? []),
      "valueopt",
    ];

    const valueLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 valueopt plain"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        schema,
        valueLine,
        3,
        valueLine.tokens.length,
        "server_options",
        undefined,
        "backend",
      ),
    ).toBe(5);

    schema.keywords.pairopt = {
      name: "pairopt",
      sections: ["backend"],
      signatures: ["pairopt [via <value>] later"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["pairopt [via <value>] later"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 3,
            slots: [
              { enum: ["via"], optional: true, value_kind: "enum", variadic: false },
              { enum: [], optional: false, value_kind: "name", variadic: false },
              { enum: ["later"], optional: false, value_kind: "enum", variadic: false },
            ],
          },
        },
      ],
    };
    const pairLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 pairopt later"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        schema,
        pairLine,
        3,
        pairLine.tokens.length,
        "server_options",
        "server",
        "backend",
      ),
    ).toBeGreaterThan(3);

    schema.keywords.lateropt = {
      name: "lateropt",
      sections: ["backend"],
      signatures: ["lateropt [unused] alt"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["lateropt [unused] alt"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 1,
            max_args: 2,
            slots: [
              { enum: ["unused"], optional: true, value_kind: "enum", variadic: false },
              { enum: ["alt"], optional: false, value_kind: "enum", variadic: false },
            ],
          },
        },
      ],
    };
    const laterLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 lateropt alt"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        schema,
        laterLine,
        3,
        laterLine.tokens.length,
        "server_options",
        "server",
        "backend",
      ),
    ).toBeGreaterThan(3);

    schema.keywords.tailopt = {
      name: "tailopt",
      sections: ["backend"],
      signatures: ["tailopt on <value>"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["tailopt on <value>"],
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
    const tailLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 tailopt on plain"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        schema,
        tailLine,
        3,
        tailLine.tokens.length,
        "server_options",
        "server",
        "backend",
      ),
    ).toBe(6);

    schema.keywords.enumconsume = {
      name: "enumconsume",
      sections: ["backend"],
      signatures: ["enumconsume on"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["enumconsume on"],
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
    const enumLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 enumconsume unexpected"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        schema,
        enumLine,
        3,
        enumLine.tokens.length,
        "server_options",
        "server",
        "backend",
      ),
    ).toBe(5);

    schema.keywords.tailonly = {
      name: "tailonly",
      sections: ["backend"],
      signatures: ["tailonly on <value>"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["tailonly on <value>"],
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
    const tailOnlyLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 tailonly on raw"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        schema,
        tailOnlyLine,
        3,
        tailOnlyLine.tokens.length,
        "server_options",
        "server",
        "backend",
      ),
    ).toBe(6);

    schema.keywords.breakopt = {
      name: "breakopt",
      sections: ["backend"],
      signatures: ["breakopt [<value>]"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["breakopt [<value>]"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 0,
            max_args: 1,
            slots: [{ enum: [], optional: true, value_kind: "generic", variadic: false }],
          },
        },
      ],
    };
    const breakLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 breakopt nextopt"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        schema,
        breakLine,
        3,
        breakLine.tokens.length,
        "server_options",
        "server",
        "backend",
      ),
    ).toBe(4);

    schema.keywords.pairskip = {
      name: "pairskip",
      sections: ["backend"],
      signatures: ["pairskip [via <value>] later"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["pairskip [via <value>] later"],
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
    const pairSkipLine = parseDocument(
      createDocument("backend api\n    server s1 127.0.0.1:80 pairskip later"),
    )[1];
    expect(
      computeLineOptionArgumentEnd(
        schema,
        pairSkipLine,
        3,
        pairSkipLine.tokens.length,
        "server_options",
        "server",
        "backend",
      ),
    ).toBe(5);
  });
});
