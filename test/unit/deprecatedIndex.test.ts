import { buildDeprecatedIndex } from "../../src/deprecatedIndex";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("deprecatedIndex", () => {
  it("returns cached index per schema/language pair", () => {
    const first = buildDeprecatedIndex(bundle.schema, bundle.languageData);
    const second = buildDeprecatedIndex(bundle.schema, bundle.languageData);
    expect(first).toBe(second);
  });

  it("supports schema-only mode without language data", () => {
    const index = buildDeprecatedIndex(bundle.schema);
    expect(index.keywords.size).toBeGreaterThanOrEqual(0);
    expect(index.actions.size).toBe(0);
  });

  it("handles language data with missing action groups", () => {
    const data = structuredClone(bundle.languageData);
    data.groups = {};
    const index = buildDeprecatedIndex(bundle.schema, data);
    expect(index.actions).toEqual(new Set());
  });

  it("indexes deprecated sample converters from schema and language data", () => {
    const schema = structuredClone(bundle.schema);
    schema.sample_converters = {
      ...schema.sample_converters,
      legacy_conv: {
        name: "legacy_conv",
        signature: "legacy_conv()",
        deprecated: true,
        args: [],
        chapter: "7.3.1",
        contexts: [],
        description: "",
        in_type: "str",
        out_type: "str",
        max_args: 0,
      },
    };
    const data = structuredClone(bundle.languageData);
    data.groups.sample_converters = [
      ...(data.groups.sample_converters ?? []),
      {
        name: "lang_conv",
        description: "",
        signature: "lang_conv() (deprecated)",
        rulesets: [],
      },
    ];
    const index = buildDeprecatedIndex(schema, data);
    expect(index.sampleConverters.has("legacy_conv")).toBe(true);
    expect(index.sampleConverters.has("lang_conv")).toBe(true);
  });

  it("indexes deprecated sample fetches from signature marks", () => {
    const schema = structuredClone(bundle.schema);
    schema.sample_fetches = {
      ...schema.sample_fetches,
      legacy_fetch: {
        name: "legacy_fetch",
        signature: "legacy_fetch() (deprecated)",
        args: [],
        out_type: "str",
        chapter: "7.3",
        contexts: [],
        description: "",
        max_args: 0,
      },
    };
    const data = structuredClone(bundle.languageData);
    data.groups.sample_fetches = [
      ...(data.groups.sample_fetches ?? []),
      {
        name: "lang_fetch",
        description: "",
        signature: "lang_fetch() (deprecated)",
        rulesets: [],
      },
    ];
    const index = buildDeprecatedIndex(schema, data);
    expect(index.sampleFetches.has("legacy_fetch")).toBe(true);
    expect(index.sampleFetches.has("lang_fetch")).toBe(true);
  });
});
