import { describe, expect, expectTypeOf, it } from "vitest";

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

import { normalizeSchemaData } from "../../../src/schema/contract";
import { symbolRecord, symbolStringList } from "../../../src/schema/symbols";
import { validationRecord, validationStringMap } from "../../../src/schema/validation";
import type {
  FetchReference,
  SchemaValidationRules,
  KeysOfType,
  RecordKeys,
} from "../../../src/schema/metadata.generated";

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
          // @ts-expect-error Deliberately malformed metadata exercises runtime validation.
          validation_rules: { ...bundle.schema.validation_rules, bad: "not-an-array" },
        },
        "bad",
      ),
    ).toThrow(/validation_rules\.bad/);
  });

  it("preserves generated nested types and restricts keys by value shape", () => {
    expect(symbolRecord(bundle.schema, "sample_fetch_references").http_auth.reference_kind).toBe(
      "userlist",
    );
    expectTypeOf(symbolRecord(bundle.schema, "sample_fetch_references")).toEqualTypeOf<
      Record<string, FetchReference>
    >();
    expectTypeOf(validationRecord(bundle.schema, "converter_min_args")).toEqualTypeOf<
      Record<string, number>
    >();
    expectTypeOf<Parameters<typeof symbolStringList>[1]>().extract<"runtime_modez">().toBeNever();
    expectTypeOf<Parameters<typeof validationStringMap>[1]>()
      .extract<"converter_min_args">()
      .toBeNever();
    expectTypeOf<RecordKeys<SchemaValidationRules>>()
      .extract<"nested_keyword_skip_patterns">()
      .toBeNever();
    expectTypeOf<KeysOfType<SchemaValidationRules, string[]>>()
      .extract<"log_address_skip">()
      .toEqualTypeOf<"log_address_skip">();
  });

  it.each([null, [], "schema", 42])("rejects non-object schema input: %j", (value) => {
    expect(() => normalizeSchemaData(value)).toThrow(/metadata: schema/);
  });

  it.each([null, {}, { match_tokens: "tcp-request" }, { match_tokens: [1] }])(
    "rejects malformed nested skip patterns: %j",
    (pattern) => {
      const schema = structuredClone(bundle.schema);
      // @ts-expect-error Deliberately malformed generator output tests runtime validation.
      schema.validation_rules.nested_keyword_skip_patterns = [pattern];
      expect(() => validationObjectArray(schema, "nested_keyword_skip_patterns")).toThrow(
        /validation_rules\.nested_keyword_skip_patterns\.0/,
      );
    },
  );

  it("returns validated skip pattern tokens", () => {
    const schema = structuredClone(bundle.schema);
    schema.validation_rules.nested_keyword_skip_patterns = [
      { match_tokens: ["tcp-request", "inspect-delay"] },
    ];
    expect(validationObjectArray(schema, "nested_keyword_skip_patterns")).toEqual([
      { match_tokens: ["tcp-request", "inspect-delay"] },
    ]);
  });

  it.each([
    [false, "argument_model"],
    [{ min_args: "1", slots: [] }, "min_args"],
    [{ min_args: 0, max_args: "1", slots: [] }, "max_args"],
    [{ min_args: 0, slots: "bad" }, "slots"],
    [{ min_args: 0, slots: [null] }, "slots.0"],
    [{ min_args: 0, slots: [{ optional: "yes" }] }, "optional"],
    [{ min_args: 0, slots: [{ variadic: "yes" }] }, "variadic"],
    [{ min_args: 0, slots: [{ enum: [1] }] }, "enum"],
    [{ min_args: 0, slots: [{ value_kind: "unknown-kind" }] }, "value_kind"],
  ])("rejects malformed generated argument models: %j", (model, path) => {
    const raw = { ...bundle.schema, keywords: { probe: { argument_model: model } } };
    expect(() => normalizeSchemaData(raw)).toThrow(String(path));
  });

  it.each([true, [null], [{ argument_model: { min_args: "bad" } }]])(
    "validates models inside keyword variants: %j",
    (variants) => {
      const raw = { ...bundle.schema, keywords: { probe: { variants } } };
      expect(() => normalizeSchemaData(raw)).toThrow(/keywords.probe.variants/);
    },
  );

  it("allows absent and null models and slots without a known value kind", () => {
    const raw = {
      ...bundle.schema,
      keywords: {
        absent: {},
        nullable: { argument_model: null },
        generic: { argument_model: { min_args: 0, max_args: null, slots: [{}] } },
      },
    };
    expect(normalizeSchemaData(raw).keywords).toEqual(raw.keywords);
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
