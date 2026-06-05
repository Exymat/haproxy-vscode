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
} from "../../src/directiveUtils";
import { parseDocument } from "../../src/parser";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

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
});
