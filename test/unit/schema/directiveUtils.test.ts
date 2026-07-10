import {
  allArgumentValues,
  argumentPosition,
  argumentTokenIndices,
  argumentValuesForPosition,
  completionValuesForPosition,
  conditionalStartIndex,
  documentedEnumValueNames,
  findArgumentValue,
  getKeywordFromLanguage,
  getKeywordFromSchema,
  isEnumPerParameter,
  resolveDirective,
} from "../../../src/directiveUtils";
import { parseDocument } from "../../helpers/parse";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

const { schema, languageData } = loadSchemaBundle("3.4");

function lineAt(content: string, lineNo: number) {
  return parseDocument(createDocument(content))[lineNo];
}

describe("directiveUtils", () => {
  it("resolveDirective matches multi-word keywords", () => {
    const line = lineAt("defaults\n    balance url_param sid", 1);
    const allowed = new Set(["balance", "balance url_param", "mode"]);
    const result = resolveDirective(line, allowed);
    expect(result.matched).toBe(true);
    expect(result.keyword).toBe("balance url_param");
  });

  it("conditionalStartIndex finds if/unless before arguments", () => {
    const line = lineAt("frontend web\n    http-request deny if TRUE", 1);
    const directiveEnd = 0;
    expect(conditionalStartIndex(line, directiveEnd)).toBe(2);
    expect(argumentTokenIndices(line, directiveEnd)).toEqual([1]);
    expect(argumentPosition(1, directiveEnd)).toBe(0);
  });

  it("conditionalStartIndex returns token length when no condition", () => {
    const line = lineAt("defaults\n    mode http", 1);
    expect(conditionalStartIndex(line, 0)).toBe(line.tokens.length);
  });

  it("findArgumentValue matches values with parenthesis suffix", () => {
    const modeKw = getKeywordFromLanguage(languageData, "mode");
    const hit = findArgumentValue(modeKw?.arguments, "http");
    expect(hit?.name).toBe("http");
    expect(hit?.parameter).toBe("http");
  });

  it("findArgumentValue prefers documented parenthesized variants over empty bare aliases", () => {
    const hit = findArgumentValue(
      [
        {
          parameter: "<algorithm>",
          description: "",
          values: [
            { name: "random", description: "" },
            { name: "random(<draws>)", description: "Random load balancing." },
          ],
        },
      ],
      "random",
    );
    expect(hit?.name).toBe("random(<draws>)");
    expect(hit?.description).toBe("Random load balancing.");
  });

  it("findArgumentValue returns undefined without params", () => {
    expect(findArgumentValue(undefined, "http")).toBeUndefined();
  });

  it("isEnumPerParameter detects per-parameter enums", () => {
    const modeKw = getKeywordFromLanguage(languageData, "mode");
    expect(isEnumPerParameter(modeKw?.arguments)).toBe(true);
    expect(isEnumPerParameter(undefined)).toBe(false);
    expect(isEnumPerParameter([])).toBe(false);
  });

  it("documentedEnumValueNames uses per-parameter layout", () => {
    const modeKw = getKeywordFromLanguage(languageData, "mode");
    const schemaKw = getKeywordFromSchema(schema, "mode");
    const names = documentedEnumValueNames(modeKw, schemaKw);
    expect(names).toEqual(expect.arrayContaining(["tcp", "http", "log", "spop"]));
  });

  it("documentedEnumValueNames falls back to schema enums", () => {
    const balanceKw = getKeywordFromLanguage(languageData, "balance");
    const schemaKw = getKeywordFromSchema(schema, "balance");
    const names = documentedEnumValueNames(balanceKw, schemaKw);
    expect(names).toContain("roundrobin");
  });

  it("documentedEnumValueNames returns empty without data", () => {
    expect(documentedEnumValueNames(undefined, undefined)).toEqual([]);
  });

  it("documentedEnumValueNames uses single-parameter language values", () => {
    const langKw = {
      arguments: [
        {
          parameter: "name",
          description: "",
          values: [
            { name: "alpha", description: "" },
            { name: "beta", description: "" },
          ],
        },
      ],
    };
    expect(documentedEnumValueNames(langKw as never, undefined)).toEqual(["alpha", "beta"]);
    expect(isEnumPerParameter(langKw.arguments)).toBe(false);
  });

  it("allArgumentValues skips duplicate value names", () => {
    const params = [
      {
        parameter: "a",
        description: "",
        values: [{ name: "Same", description: "first" }],
      },
      {
        parameter: "b",
        description: "",
        values: [{ name: "same", description: "second" }],
      },
    ];
    expect(allArgumentValues(params)).toHaveLength(1);
  });

  it("argumentValuesForPosition handles url_param branch", () => {
    const params = [
      {
        parameter: "url_param",
        description: "url param algorithm",
        values: [{ name: "check_post", description: "check POST body" }],
      },
      { parameter: "<arguments>", description: "", values: [] },
    ];
    const line = lineAt("defaults\n    balance url_param sid", 1);
    expect(argumentValuesForPosition(params, 0, line, 0).map((v) => v.name)).toEqual(["url_param"]);
    expect(argumentValuesForPosition(params, 1, line, 0).map((v) => v.name)).toEqual([
      "check_post",
    ]);
  });

  it("argumentValuesForPosition uses algorithm slot values", () => {
    const balanceKw = getKeywordFromLanguage(languageData, "balance");
    const line = lineAt("defaults\n    balance roundrobin", 1);
    const values = argumentValuesForPosition(balanceKw?.arguments, 0, line, 0);
    expect(values.map((v) => v.name)).toContain("roundrobin");
  });

  it("argumentValuesForPosition picks slot by position", () => {
    const params = [
      { parameter: "<first>", description: "", values: [{ name: "a", description: "" }] },
      { parameter: "<second>", description: "", values: [{ name: "b", description: "" }] },
    ];
    const line = lineAt("defaults\n    directive first second", 1);
    expect(argumentValuesForPosition(params, 1, line, 0).map((v) => v.name)).toEqual(["b"]);
  });

  it("allArgumentValues deduplicates values", () => {
    const modeKw = getKeywordFromLanguage(languageData, "mode");
    const values = allArgumentValues(modeKw?.arguments);
    const keys = values.map((v) => v.name.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(allArgumentValues(undefined)).toEqual([]);
  });

  it("completionValuesForPosition merges schema and language values", () => {
    const balanceKw = getKeywordFromLanguage(languageData, "balance");
    const schemaKw = getKeywordFromSchema(schema, "balance");
    const line = lineAt("defaults\n    balance ", 1);
    const values = completionValuesForPosition(schemaKw, balanceKw, 0, line, 0, "balance");
    expect(values.map((v) => v.name)).toContain("roundrobin");
    expect(values.map((v) => v.name)).not.toContain("balance");
  });

  it("getKeywordFromLanguage and getKeywordFromSchema are case-insensitive", () => {
    expect(getKeywordFromLanguage(languageData, "MODE")?.name).toBe("mode");
    expect(getKeywordFromSchema(schema, "MODE")?.name).toBe("mode");
  });

  it("completionValuesForPosition uses packed-value fallback after address tokens", () => {
    const schemaKw = {
      name: "testpacked",
      sections: ["defaults"],
      signatures: [],
      sources: [],
      contexts: [],
      argument_model: {
        min_args: 1,
        max_args: 3,
        slots: [
          { optional: false, value_kind: "address", enum: [] },
          { optional: true, value_kind: "generic", enum: [] },
          { optional: true, value_kind: "enum", enum: ["interface", "usesrc"] },
        ],
      },
    };
    const line = lineAt("defaults\n    testpacked 0.0.0.0 ", 1);
    const values = completionValuesForPosition(schemaKw, undefined, 1, line, 0, "testpacked");
    expect(values.map((v) => v.name)).toEqual(expect.arrayContaining(["interface", "usesrc"]));
  });

  it("completionValuesForPosition skips packed fallback for non-generic slots", () => {
    const schemaKw = {
      name: "testpacked",
      sections: ["defaults"],
      signatures: [],
      sources: [],
      contexts: [],
      argument_model: {
        min_args: 1,
        max_args: 1,
        slots: [{ optional: false, value_kind: "address", enum: [] }],
      },
    };
    const line = lineAt("defaults\n    testpacked 0.0.0.0 ", 1);
    expect(
      completionValuesForPosition(schemaKw as never, undefined, 0, line, 0, "testpacked"),
    ).toEqual([]);
  });

  it("completionValuesForPosition skips packed fallback when previous token is not an address", () => {
    const schemaKw = {
      name: "testpacked",
      sections: ["defaults"],
      signatures: [],
      sources: [],
      contexts: [],
      argument_model: {
        min_args: 1,
        max_args: 3,
        slots: [
          { optional: false, value_kind: "address", enum: [] },
          { optional: true, value_kind: "generic", enum: [] },
          { optional: true, value_kind: "enum", enum: ["alpha"] },
        ],
      },
    };
    const line = lineAt("defaults\n    testpacked notaddr ", 1);
    expect(
      completionValuesForPosition(schemaKw as never, undefined, 1, line, 0, "testpacked"),
    ).toEqual([]);
  });

  it("completionValuesForPosition packed fallback stops before required slots", () => {
    const schemaKw = {
      name: "testpacked",
      sections: ["defaults"],
      signatures: [],
      sources: [],
      contexts: [],
      argument_model: {
        min_args: 1,
        max_args: 4,
        slots: [
          { optional: false, value_kind: "address", enum: [] },
          { optional: true, value_kind: "generic", enum: [] },
          { optional: true, value_kind: "generic", enum: [] },
          { optional: false, value_kind: "name", enum: [] },
        ],
      },
    };
    const line = lineAt("defaults\n    testpacked 0.0.0.0 ", 1);
    expect(
      completionValuesForPosition(schemaKw as never, undefined, 1, line, 0, "testpacked"),
    ).toEqual([]);
  });

  it("completionValuesForPosition packed fallback returns empty when no later enums exist", () => {
    const schemaKw = {
      name: "testpacked",
      sections: ["defaults"],
      signatures: [],
      sources: [],
      contexts: [],
      argument_model: {
        min_args: 1,
        max_args: 4,
        slots: [
          { optional: false, value_kind: "address", enum: [] },
          { optional: true, value_kind: "generic", enum: [] },
          { optional: true, value_kind: "generic", enum: [] },
          { optional: true, value_kind: "name", enum: [] },
        ],
      },
    };
    const line = lineAt("defaults\n    testpacked 0.0.0.0 ", 1);
    expect(
      completionValuesForPosition(schemaKw as never, undefined, 1, line, 0, "testpacked"),
    ).toEqual([]);
  });

  it("handles packed fallback branches when schema slots or previous args are missing", () => {
    const line = lineAt("defaults\n    testpacked", 1);
    expect(completionValuesForPosition(undefined, undefined, 0, line, 0, "testpacked")).toEqual([]);

    const schemaKw = {
      name: "testpacked",
      sections: ["defaults"],
      signatures: [],
      sources: [],
      contexts: [],
      argument_model: {
        min_args: 1,
        max_args: 2,
        slots: [{ optional: false, value_kind: "name", enum: [] }],
      },
    };
    expect(
      completionValuesForPosition(schemaKw as never, undefined, 0, line, 0, "testpacked"),
    ).toEqual([]);
  });

  it("returns empty when fallback slot values are unavailable", () => {
    const params = [
      { parameter: "<first>", description: "", values: [{ name: "a", description: "" }] },
      { parameter: "<second>", description: "" },
    ];
    const line = lineAt("defaults\n    directive first", 1);
    expect(argumentValuesForPosition(params as never, 5, line, 0)).toEqual([]);
  });
});
