import { describe, expect, it } from "vitest";

import {
  LINE_OPTION_CHAPTER_BIND,
  LINE_OPTION_CHAPTER_SERVER,
  lineOptionChapter,
  resolveLineOptionSchemaKeyword,
  resolveNestedOptionKeyword,
} from "../../../src/lineOptionKeyword";
import { bundles } from "./helpers";

describe("line option keyword helpers", () => {
  it("covers line-option schema resolution fallbacks", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    schema.keywords.testfallback = {
      name: "testfallback",
      sections: ["frontend"],
      signatures: ["testfallback <base>"],
      sources: [],
      contexts: [],
      arguments: [{ parameter: "base", description: "base", values: [] }],
      argument_model: {
        min_args: 1,
        max_args: 1,
        slots: [{ enum: [], optional: false, value_kind: "name", variadic: false }],
      },
      variants: [
        {
          chapter: "5.1",
          sections: ["frontend"],
          signatures: ["testfallback"],
          contexts: [],
          arguments: [],
          argument_model: {
            min_args: 0,
            max_args: 0,
            slots: [],
          },
        },
      ],
    };
    expect(
      resolveLineOptionSchemaKeyword(schema, "testfallback", undefined, "frontend")?.chapter,
    ).toBe("5.1");
    expect(resolveLineOptionSchemaKeyword(schema, "testfallback", "bind", "frontend")?.name).toBe(
      "testfallback",
    );
    expect(resolveNestedOptionKeyword(schema, "frontend", "bind", "missing")).toBe(undefined);
  });

  it("falls back to normal schema resolution when a semantic chapter variant is missing", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    schema.keywords.novariant = {
      name: "novariant",
      sections: ["frontend"],
      signatures: ["novariant"],
      sources: [],
      contexts: [],
      arguments: [],
      variants: [],
      line_option_semantics: [
        {
          parent_kind: "bind",
          option_group: "bind_options",
          chapter: "5.1",
        },
      ],
    };
    const resolved = resolveLineOptionSchemaKeyword(schema, "novariant", "bind", null);
    expect(resolved?.name).toBe("novariant");
    expect(resolved?.chapter).not.toBe(LINE_OPTION_CHAPTER_BIND);
  });

  it("covers line-option keyword fallback branches and chapter selection", () => {
    expect(lineOptionChapter("bind")).toBe(LINE_OPTION_CHAPTER_BIND);
    expect(lineOptionChapter("server")).toBe(LINE_OPTION_CHAPTER_SERVER);

    const schema = structuredClone(bundles["3.4"].schema);
    schema.keywords.testtoplevel = {
      name: "testtoplevel",
      sections: ["backend"],
      signatures: ["testtoplevel <base>"],
      sources: [],
      contexts: ["tcp"],
      arguments: [{ parameter: "base", description: "base", values: [] }],
      argument_model: {
        min_args: 2,
        max_args: 2,
        slots: [
          { enum: [], optional: false, value_kind: "name", variadic: false },
          { enum: [], optional: false, value_kind: "name", variadic: false },
        ],
      },
      variants: [
        {
          chapter: "5.2",
          sections: [],
          signatures: [],
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
    schema.keywords.testtoplevel.line_option_semantics = [
      {
        parent_kind: "server",
        option_group: "server_options",
        chapter: "5.2",
      },
    ];
    const resolved = resolveLineOptionSchemaKeyword(schema, "testtoplevel", "server", "backend");
    expect(resolved?.sections).toEqual(["backend"]);
    expect(resolved?.signatures).toEqual(["testtoplevel <base>"]);
    expect(resolved?.arguments).toEqual(schema.keywords.testtoplevel.arguments);
    expect(resolved?.contexts).toEqual(["tcp"]);

    schema.keywords.testvariant = {
      name: "testvariant",
      sections: ["backend"],
      signatures: ["testvariant <base>"],
      sources: [],
      contexts: ["http"],
      arguments: [{ parameter: "base", description: "base", values: [] }],
      argument_model: {
        min_args: 1,
        max_args: 1,
        slots: [{ enum: [], optional: false, value_kind: "name", variadic: false }],
      },
      variants: [
        {
          chapter: "5.2",
          sections: ["frontend"],
          signatures: ["testvariant <variant>"],
          contexts: ["tcp"],
          arguments: [{ parameter: "variant", description: "variant", values: [] }],
          argument_model: {
            min_args: 2,
            max_args: 2,
            slots: [
              { enum: [], optional: false, value_kind: "name", variadic: false },
              { enum: [], optional: false, value_kind: "name", variadic: false },
            ],
          },
        },
      ],
      line_option_semantics: [
        {
          parent_kind: "server",
          option_group: "server_options",
          chapter: "5.2",
        },
      ],
    };
    const variant = resolveLineOptionSchemaKeyword(schema, "testvariant", "server", "backend");
    expect(variant?.sections).toEqual(["frontend"]);
    expect(variant?.signatures).toEqual(["testvariant <variant>"]);
    expect(variant?.arguments).toEqual(schema.keywords.testvariant.variants?.[0].arguments);
    expect(variant?.contexts).toEqual(["tcp"]);
    expect(variant?.argument_model).toEqual(
      schema.keywords.testvariant.variants?.[0].argument_model,
    );

    expect(resolveLineOptionSchemaKeyword(schema, "missing", "server", "backend")).toBeUndefined();
  });
});
