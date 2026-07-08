import { afterEach, describe, expect, it, vi } from "vitest";

import { addSectionExtra } from "../../../src/hover/markdown";
import { getLineSemanticContext } from "../../../src/lineSemanticContext";
import { tryLineOptionHover } from "../../../src/hover/handlers/lineOptionHover";
import { createDocument } from "../../helpers/document";
import { Range } from "../../__mocks__/vscode";
import { bundles, hoverMarkdown, hoverText } from "./helpers";
import { provideHover } from "../../../src/hover";

describe("provideHover nested line options", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("documents nested source and server options", () => {
    expect(
      hoverMarkdown(
        "backend api\n    server s1 127.0.0.1:80 source 0.0.0.0 interface eth0",
        1,
        "    server s1 127.0.0.1:80 source 0.0.0.0 interface eth0".indexOf("interface"),
        "3.4",
      ),
    ).toContain("**interface**");
    expect(
      hoverMarkdown(
        "backend api\n    server s1 127.0.0.1:80 check junk ssl",
        1,
        "    server s1 127.0.0.1:80 check junk ssl".indexOf("ssl"),
        "3.4",
      ).toLowerCase(),
    ).toContain("ssl");
    expect(
      hoverMarkdown(
        "backend api\n    server s1 127.0.0.1:80 check inter 2s if MYACL",
        1,
        "    server s1 127.0.0.1:80 check inter 2s if MYACL".indexOf("inter"),
        "3.4",
      ).toLowerCase(),
    ).toContain("inter");
  });

  it("covers value-taking nested options without argument models", () => {
    const doc = createDocument("backend api\n    server s1 127.0.0.1:80 testvalopt myval");
    const schema = structuredClone(bundles["3.4"].schema);
    schema.keywords.testvalopt = {
      name: "testvalopt",
      sections: ["backend"],
      signatures: ["testvalopt <value>"],
      sources: [],
      contexts: [],
      arguments: [],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testvalopt",
    ];
    schema.keyword_groups.server_options_with_value = [
      ...(schema.keyword_groups.server_options_with_value ?? []),
      "testvalopt",
    ];
    const data = structuredClone(bundles["3.4"].languageData);
    data.groups.server_options = [
      ...(data.groups.server_options ?? []),
      {
        name: "testvalopt",
        description: "Custom value option.",
        docsUrl: undefined,
        rulesets: [],
        signature: "testvalopt <value>",
      },
    ];
    const valueHover = provideHover(
      doc,
      {
        line: 1,
        character: "    server s1 127.0.0.1:80 testvalopt myval".indexOf("myval") + 1,
      } as never,
      data,
      schema,
    );
    expect(valueHover).not.toBeNull();
    if (!valueHover) {
      throw new Error("expected hover");
    }
    expect(hoverText(valueHover)).toContain("testvalopt");
  });

  it("covers line-option hover branches for nested values, forms, and empty docs", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    const data = structuredClone(bundles["3.4"].languageData);
    schema.keywords.testlineopt = {
      name: "testlineopt",
      sections: ["backend"],
      signatures: ["testlineopt mode <value>", "testlineopt mode <other>"],
      sources: [],
      contexts: [],
      arguments: [
        {
          parameter: "value",
          description: "line-option value",
          values: [{ name: "value1", description: "value one" }],
        },
      ],
      variants: [
        {
          chapter: "5.2",
          sections: ["backend"],
          signatures: ["testlineopt mode <value>", "testlineopt mode <other>"],
          contexts: [],
          arguments: [
            {
              parameter: "value",
              description: "line-option value",
              values: [{ name: "value1", description: "value one" }],
            },
          ],
          argument_model: {
            min_args: 2,
            max_args: 2,
            slots: [
              { enum: ["mode"], optional: false, value_kind: "enum", variadic: false },
              { enum: [], optional: false, value_kind: "name", variadic: false },
            ],
          },
        },
      ],
    };
    schema.keyword_group_contexts = {
      ...schema.keyword_group_contexts,
      server_options: {
        ...(schema.keyword_group_contexts?.server_options ?? {}),
        testlineopt: ["tcp"],
      },
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testlineopt",
    ];
    data.groups.server_options = [
      ...(data.groups.server_options ?? []),
      {
        name: "testlineopt",
        description: "Line option docs.",
        docsUrl: "https://example.test/testlineopt",
        rulesets: [],
        signature: "testlineopt mode <value>",
      },
      {
        name: "childlineopt",
        description: "Child option docs.",
        docsUrl: "https://example.test/childlineopt",
        rulesets: [],
        signature: "childlineopt",
      },
      {
        name: "emptylineopt",
        description: "",
        docsUrl: undefined,
        rulesets: [],
        signature: "emptylineopt",
      },
    ];
    schema.keyword_groups.server_options.push("childlineopt", "emptylineopt");
    schema.keywords.childlineopt = {
      name: "childlineopt",
      sections: ["backend"],
      signatures: ["childlineopt"],
      sources: [],
      contexts: ["http"],
      arguments: [],
    };

    const argHover = provideHover(
      createDocument("backend api\n    server s1 127.0.0.1:80 testlineopt mode value1"),
      {
        line: 1,
        character: "    server s1 127.0.0.1:80 testlineopt mode value1".indexOf("value1") + 1,
      } as never,
      data,
      schema,
    );
    expect(argHover).not.toBeNull();
    if (!argHover) {
      throw new Error("expected hover");
    }
    expect(hoverText(argHover)).toContain("**Nested option:** testlineopt");

    const groupText = hoverText(
      provideHover(
        createDocument("backend api\n    server s1 127.0.0.1:80 testlineopt mode value1"),
        {
          line: 1,
          character: "    server s1 127.0.0.1:80 testlineopt".indexOf("testlineopt") + 1,
        } as never,
        data,
        schema,
      ) ??
        (() => {
          throw new Error("expected hover");
        })(),
    );
    expect(groupText).toContain("Forms:");

    const nestedText = hoverText(
      provideHover(
        createDocument("backend api\n    server s1 127.0.0.1:80 testlineopt childlineopt"),
        {
          line: 1,
          character:
            "    server s1 127.0.0.1:80 testlineopt childlineopt".indexOf("childlineopt") + 1,
        } as never,
        data,
        schema,
      ) ??
        (() => {
          throw new Error("expected hover");
        })(),
    );
    expect(nestedText).toContain("Child option docs.");
  });

  it("returns null from tryLineOptionHover when the nested option has no docs", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    const data = structuredClone(bundles["3.4"].languageData);
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "emptylineopt",
    ];
    data.groups.server_options = [
      ...(data.groups.server_options ?? []),
      {
        name: "emptylineopt",
        description: "",
        docsUrl: undefined,
        rulesets: [],
        signature: "emptylineopt",
      },
    ];
    const lineText = "    server s1 127.0.0.1:80 emptylineopt";
    const doc = createDocument(`backend api\n${lineText}`);
    const position = { line: 1, character: lineText.indexOf("emptylineopt") + 1 } as never;
    const semantic = getLineSemanticContext(doc, position, schema, data);
    if (!semantic?.ctx.token) {
      throw new Error("expected line-option token");
    }
    expect(
      tryLineOptionHover({
        document: doc,
        position,
        data,
        schema,
        semantic,
        ctx: semantic.ctx as never,
        range: new Range(1, semantic.ctx.token.start, 1, semantic.ctx.token.end) as never,
        cursorOffset: 0,
        tokenLower: semantic.ctx.token.text.toLowerCase(),
      }),
    ).toBeNull();
  });

  it("handles schema-driven nonstandard line-option groups", () => {
    const schema = structuredClone(bundles["3.4"].schema);
    const data = structuredClone(bundles["3.4"].languageData);
    schema.semantic_groups = {
      ...schema.semantic_groups,
      line_option_group_for_kind: {
        ...(schema.semantic_groups.line_option_group_for_kind as Record<string, string>),
        custom: "custom_options",
      },
    };
    schema.keyword_groups.custom_options = ["barelineopt", "childbare"];
    schema.keywords.barelineopt = {
      name: "barelineopt",
      sections: ["backend"],
      signatures: [],
      sources: [],
      contexts: ["http"],
      arguments: [],
    };
    schema.keywords.childbare = {
      name: "childbare",
      sections: ["backend"],
      signatures: [],
      sources: [],
      contexts: ["tcp"],
      arguments: [],
    };
    data.groups.custom_options = [
      {
        name: "barelineopt",
        description: "Bare line-option docs.",
        docsUrl: undefined,
        rulesets: [],
        signature: undefined as never,
      },
      {
        name: "childbare",
        description: "Child line-option docs.",
        docsUrl: undefined,
        rulesets: [],
        signature: undefined as never,
      },
    ];

    const lineText = "    custom barelineopt childbare";
    const doc = createDocument(`backend api\n${lineText}`);
    const position = { line: 1, character: lineText.indexOf("barelineopt") + 1 } as never;
    const semantic = getLineSemanticContext(doc, position, schema, data);
    if (!semantic?.ctx.token) {
      throw new Error("expected synthetic line-option token");
    }

    const topHover = tryLineOptionHover({
      document: doc,
      position,
      data,
      schema,
      semantic,
      ctx: {
        ...semantic.ctx,
        kind: "custom",
        tokenIndex: 1,
        token: semantic.ctx.line.tokens[1],
      } as never,
      range: new Range(
        1,
        semantic.ctx.line.tokens[1].start,
        1,
        semantic.ctx.line.tokens[1].end,
      ) as never,
      cursorOffset: 0,
      tokenLower: "barelineopt",
      analyzed: {
        ...semantic.analyzed,
        statement: { rule: { keyword: "custom", kind: "custom", nested_start_index: 1 } },
      } as never,
    });
    expect(topHover).not.toBeNull();
    if (!topHover) {
      throw new Error("expected top-level line-option hover");
    }
    expect(hoverText(topHover)).toContain("Bare line-option docs.");

    const childToken = semantic.ctx.line.tokens[2];
    const childHover = tryLineOptionHover({
      document: doc,
      position: { line: 1, character: childToken.start + 1 } as never,
      data,
      schema,
      semantic,
      ctx: {
        ...semantic.ctx,
        kind: "custom",
        tokenIndex: 2,
        token: childToken,
      } as never,
      range: new Range(1, childToken.start, 1, childToken.end) as never,
      cursorOffset: 0,
      tokenLower: "childbare",
      analyzed: {
        ...semantic.analyzed,
        statement: { rule: { keyword: "custom", kind: "custom", nested_start_index: 1 } },
      } as never,
    });
    expect(childHover).not.toBeNull();
    if (!childHover) {
      throw new Error("expected child line-option hover");
    }
    expect(hoverText(childHover)).toContain("Child line-option docs.");
  });

  it("covers simple markdown helpers around line-option hovers", () => {
    const extras: string[] = [];
    addSectionExtra(extras, undefined);
    addSectionExtra(extras, []);
    expect(extras).toEqual([]);
  });
});
