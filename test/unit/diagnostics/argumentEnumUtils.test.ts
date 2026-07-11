import {
  docEnumValueNames,
  enumDescriptionsForKeyword,
  enumNamesForArgumentPosition,
  enumNamesForSlot,
  enumNamesForSlotLower,
  filterDirectiveKeywordParts,
  mergeEnumValues,
  normalizeEnumDisplayName,
} from "../../../src/diagnostics/argumentEnumUtils";
import type { LanguageKeyword } from "../../../src/language/languageData";
import type { ArgumentSlot, SchemaKeyword } from "../../../src/schema/types";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");

function mockSchemaKw(overrides: Partial<SchemaKeyword> = {}): SchemaKeyword {
  return {
    name: "test",
    sections: [],
    signatures: [],
    arguments: [],
    sources: [],
    ...overrides,
  };
}

describe("argumentEnumUtils", () => {
  it("normalizeEnumDisplayName strips quoted names", () => {
    expect(normalizeEnumDisplayName('"hello"')).toBe("hello");
    expect(normalizeEnumDisplayName("plain")).toBe("plain");
  });

  it("docEnumValueNames keeps simple enum tokens", () => {
    const schemaKw = mockSchemaKw({
      arguments: [
        {
          parameter: "<mode>",
          description: "",
          values: [
            { name: "tcp", description: "tcp mode" },
            { name: "bad value", description: "ignored" },
          ],
        },
      ],
    });
    expect(docEnumValueNames(schemaKw)).toEqual(["tcp"]);
  });

  it("docEnumValueNames skips undefined argument entries", () => {
    const argumentsWithHole: SchemaKeyword["arguments"] = [];
    argumentsWithHole[1] = { parameter: "<mode>", description: "", values: [] };
    const schemaKw = mockSchemaKw({
      arguments: argumentsWithHole,
    });
    expect(docEnumValueNames(schemaKw)).toEqual([]);
  });

  it("docEnumValueNames ignores explicit undefined params", () => {
    const schemaKw = mockSchemaKw({
      arguments: [undefined] as unknown as SchemaKeyword["arguments"],
    });
    expect(docEnumValueNames(schemaKw)).toEqual([]);
  });

  it("enumNamesForSlot ignores non-simple parameter value names", () => {
    const schemaKw = mockSchemaKw({
      arguments: [
        {
          parameter: "<mode>",
          description: "",
          values: [
            { name: "tcp", description: "" },
            { name: "bad value", description: "" },
          ],
        },
      ],
    });
    expect(enumNamesForSlot(undefined, schemaKw, 0)).toEqual([]);
  });

  it("enumNamesForSlot uses value_kind enum without doc parameter heuristics", () => {
    const schemaKw = mockSchemaKw({
      argument_model: {
        min_args: 1,
        max_args: 1,
        slots: [{ value_kind: "enum", enum: ["roundrobin"] }],
      },
      arguments: [{ parameter: "<name>", description: "", values: [] }],
    });
    expect(enumNamesForSlot(undefined, schemaKw, 0)).toEqual([]);
    expect(
      enumNamesForSlot({ enum: ["roundrobin"] }, schemaKw, 0).map((n) => n.toLowerCase()),
    ).toContain("roundrobin");
  });

  it("enumNamesForSlotLower lowercases without schema keyword cache", () => {
    expect(enumNamesForSlotLower({ enum: ["HTTP", "TCP"] }, undefined, 0)).toEqual(["http", "tcp"]);
  });

  it("enumNamesForSlot merges signature and doc enums", () => {
    const slot: ArgumentSlot = { enum: ["TCP", "HTTP"] };
    const schemaKw = mockSchemaKw({
      arguments: [
        {
          parameter: "<mode>",
          description: "",
          values: [
            { name: "log", description: "" },
            { name: "spop", description: "" },
          ],
        },
      ],
    });
    const names = enumNamesForSlot(slot, schemaKw, 0);
    expect(names.map((n) => n.toLowerCase())).toEqual(
      expect.arrayContaining(["tcp", "http", "log", "spop"]),
    );
  });

  it("enumNamesForSlot returns empty when doc hints are disabled", () => {
    const schemaKw = mockSchemaKw({
      arguments: [
        {
          parameter: "name",
          description: "",
          values: [
            { name: "a", description: "" },
            { name: "b", description: "" },
          ],
        },
      ],
    });
    expect(enumNamesForSlot(undefined, schemaKw, 0)).toEqual([]);
  });

  it("enumNamesForSlot returns doc enums for typed parameters with enough values", () => {
    const schemaKw = mockSchemaKw({
      arguments: [
        {
          parameter: "<mode>",
          description: "",
          values: [
            { name: "tcp", description: "" },
            { name: "http", description: "" },
          ],
        },
      ],
    });
    expect(enumNamesForSlot(undefined, schemaKw, 0)).toEqual(["tcp", "http"]);
  });

  it("enumNamesForSlot returns empty for single doc enum", () => {
    const schemaKw = mockSchemaKw({
      arguments: [
        {
          parameter: "<mode>",
          description: "",
          values: [{ name: "tcp", description: "" }],
        },
      ],
    });
    expect(enumNamesForSlot(undefined, schemaKw, 0)).toEqual([]);
  });

  it("enumNamesForSlot uses algorithm slot at position zero", () => {
    const balanceSchema = schema.keywords.balance;
    const names = enumNamesForSlot(undefined, balanceSchema, 0);
    expect(names.length).toBeGreaterThan(2);
  });

  it("enumNamesForSlot falls back to algorithm parameter at position zero", () => {
    const args: SchemaKeyword["arguments"] = [];
    args[1] = {
      parameter: "<algorithm>",
      description: "",
      values: [
        { name: "roundrobin", description: "" },
        { name: "leastconn", description: "" },
      ],
    };
    expect(enumNamesForSlot(undefined, mockSchemaKw({ arguments: args }), 0)).toEqual([
      "roundrobin",
      "leastconn",
    ]);
  });

  it("enumNamesForSlot handles missing parameter entry for balance url_param variant", () => {
    const names = enumNamesForSlot(
      { enum: ["foo"] },
      mockSchemaKw({
        name: "balance url_param",
        arguments: [],
      }),
      1,
    );
    expect(names).toEqual(["foo"]);
  });

  it("enumNamesForSlot returns lowercase fallback when doc source has no matching param value", () => {
    const names = enumNamesForSlot(
      { enum: ["HTTP"] },
      mockSchemaKw({
        arguments: [
          { parameter: "<a>", description: "", values: [{ name: "tcp", description: "" }] },
          { parameter: "<b>", description: "", values: [{ name: "grpc", description: "" }] },
        ],
      }),
      1,
    );
    expect(names.map((n) => n.toLowerCase())).toContain("tcp");
  });

  it("enumNamesForSlot keeps lowercase fallback when doc source entry has no param match", () => {
    const names = enumNamesForSlot(
      { enum: ["HTTP"] },
      mockSchemaKw({
        arguments: [
          { parameter: "<first>", description: "", values: [{ name: "spop", description: "" }] },
          { parameter: "<second>", description: "", values: [{ name: "grpc", description: "" }] },
        ],
      }),
      1,
    );
    expect(names).toContain("spop");
  });

  it("enumNamesForArgumentPosition prefers slot enums", () => {
    const balanceSchema = schema.keywords.balance;
    const balanceLang = {
      arguments: balanceSchema.arguments,
    } as LanguageKeyword;
    const names = enumNamesForArgumentPosition(balanceSchema, balanceLang, 0);
    expect(names).toContain("roundrobin");
  });

  it("enumNamesForArgumentPosition falls back to language param enums", () => {
    const langKw = {
      arguments: [
        {
          parameter: "<mode>",
          description: "",
          values: [
            { name: "tcp", description: "" },
            { name: "http", description: "" },
          ],
        },
      ],
    } as LanguageKeyword;
    expect(enumNamesForArgumentPosition(undefined, langKw, 0)).toEqual(["tcp", "http"]);
  });

  it("enumNamesForArgumentPosition returns empty without matches", () => {
    expect(enumNamesForArgumentPosition(undefined, undefined, 0)).toEqual([]);
  });

  it("filterDirectiveKeywordParts removes directive tokens", () => {
    const values = [
      { name: "balance", description: "" },
      { name: "roundrobin", description: "" },
    ];
    expect(filterDirectiveKeywordParts(values, "balance").map((v) => v.name)).toEqual([
      "roundrobin",
    ]);
  });

  it("mergeEnumValues combines language and schema names", () => {
    const descriptions = new Map([["tcp", "tcp mode"]]);
    const merged = mergeEnumValues(
      [{ name: "http", description: "http mode" }],
      ["tcp"],
      descriptions,
    );
    expect(merged.map((v) => v.name)).toEqual(expect.arrayContaining(["http", "tcp"]));
    expect(merged.find((v) => v.name === "tcp")?.description).toBe("tcp mode");
  });

  it("enumDescriptionsForKeyword merges language and schema value descriptions", () => {
    const map = enumDescriptionsForKeyword(
      {
        name: "mode",
        arguments: [
          {
            parameter: "<mode>",
            values: [{ name: "http", description: "HTTP mode" }],
          },
        ],
      } as never,
      {
        arguments: [
          {
            parameter: "<mode>",
            values: [{ name: "tcp", description: "TCP mode" }],
          },
        ],
      } as never,
    );
    expect(map.get("http")).toBe("HTTP mode");
    expect(map.get("tcp")).toBe("TCP mode");
  });

  it("enumDescriptionsForKeyword supports missing language and schema keywords", () => {
    expect(enumDescriptionsForKeyword(undefined, undefined).size).toBe(0);
    expect(
      enumDescriptionsForKeyword(
        {
          name: "mode",
          arguments: [{ parameter: "<mode>", values: [{ name: "http", description: "HTTP" }] }],
        } as never,
        undefined,
      ).get("http"),
    ).toBe("HTTP");
    expect(
      enumDescriptionsForKeyword(undefined, {
        arguments: [{ parameter: "<mode>", values: [{ name: "tcp", description: "TCP" }] }],
      } as never).get("tcp"),
    ).toBe("TCP");
  });
});
