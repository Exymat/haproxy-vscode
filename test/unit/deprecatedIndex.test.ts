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
});
