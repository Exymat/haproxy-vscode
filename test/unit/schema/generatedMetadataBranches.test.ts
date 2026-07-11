import { describe, expect, it } from "vitest";

import {
  hasStatementRuleKind,
  sectionHasOptionKeywords,
  validationObjectArray,
} from "../../../src/schema";
import { buildDeprecatedIndex } from "../../../src/language/deprecatedIndex";
import {
  clearLanguageDataIndexCache,
  languageDataIndexes,
} from "../../../src/language/languageDataIndexes";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("generated schema metadata branch behavior", () => {
  afterEach(() => {
    clearLanguageDataIndexCache();
  });

  it("checks statement rule kinds and option keyword variants", () => {
    expect(hasStatementRuleKind(bundle.schema, "directive")).toBe(true);
    expect(hasStatementRuleKind(bundle.schema, "__missing_kind__")).toBe(false);
    expect(sectionHasOptionKeywords(structuredClone(bundle.schema), "defaults")).toBe(true);

    for (const keywords of [
      ["option"],
      ["option httplog"],
      ["no option httplog"],
      ["option", "option httplog", "no option missing"],
    ]) {
      const optionSchema = structuredClone(bundle.schema);
      optionSchema.sections = {
        ...optionSchema.sections,
        optionprobe: { name: "optionprobe", keywords },
      };
      expect(sectionHasOptionKeywords(optionSchema, "optionprobe")).toBe(true);
    }
  });

  it("rejects malformed validation metadata", () => {
    expect(() =>
      validationObjectArray(
        {
          ...bundle.schema,
          validation_rules: { ...bundle.schema.validation_rules, bad: "not-an-array" },
        },
        "bad",
      ),
    ).toThrow(/validation_rules\.bad/);
  });

  it("indexes deprecated converters and generated language data", () => {
    const deprecatedSchema = structuredClone(bundle.schema);
    deprecatedSchema.sample_converters = {
      ...deprecatedSchema.sample_converters,
      sig_conv: {
        name: "sig_conv",
        signature: "sig_conv() (deprecated)",
        args: [],
        chapter: "7.3",
        contexts: [],
        description: "",
        in_type: "str",
        out_type: "str",
        max_args: 0,
      },
    };

    expect(buildDeprecatedIndex(deprecatedSchema).sampleConverters.has("sig_conv")).toBe(true);
    expect(
      languageDataIndexes(structuredClone(bundle.languageData)).keywordsBySection.get("frontend")
        ?.length,
    ).toBeGreaterThan(0);
  });
});
