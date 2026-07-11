import {
  parseSectionHeader,
  sectionHeaderFromModifier,
  sectionHeaderSupportsFromModifier,
} from "../../../src/language/sectionUtils";
import { loadSchemaBundle } from "../../helpers/schema";

const { schema } = loadSchemaBundle("3.4");

describe("section header parsing", () => {
  it("resolves custom generated defaults-profile modifiers", () => {
    const customSchema = structuredClone(schema);
    customSchema.reference_patterns = [
      {
        match_tokens: ["frontend", "*", "using"],
        reference_kind: "defaults-profile",
        target_token_index: 3,
        scope: "section-header",
      },
    ];

    expect(sectionHeaderFromModifier(customSchema)).toBe("using");
    expect(sectionHeaderFromModifier()).toBe("from");
    expect(
      parseSectionHeader(headerLine("frontend", "web", "using", "base"), customSchema)?.profileName,
    ).toBe("base");
  });

  it("falls back to from when generated modifiers are ambiguous", () => {
    const customSchema = structuredClone(schema);
    customSchema.reference_patterns = [
      {
        match_tokens: ["frontend", "*"],
        reference_kind: "defaults-profile",
        target_token_index: 2,
        scope: "section-header",
      },
      {
        match_tokens: ["frontend", "*", "*"],
        reference_kind: "defaults-profile",
        target_token_index: 3,
        scope: "section-header",
      },
    ];

    expect(sectionHeaderFromModifier(customSchema)).toBe("from");
  });

  it("limits default from support to proxy/defaults section headers", () => {
    expect(sectionHeaderSupportsFromModifier(undefined, "frontend")).toBe(true);
    expect(sectionHeaderSupportsFromModifier(undefined, "peers")).toBe(false);
  });

  it("parses anonymous defaults with a parent profile", () => {
    expect(parseSectionHeader(headerLine("defaults", "from", "base"), schema)).toEqual({
      sectionType: "defaults",
      name: null,
      fromIndex: 1,
      profileName: "base",
    });
  });
});

function headerLine(...texts: string[]) {
  let start = 0;
  const tokens = texts.map((text) => {
    const token = { text, start, end: start + text.length };
    start = token.end + 1;
    return token;
  });
  return {
    line: 0,
    section: null,
    isSectionHeader: true,
    anonymousDefaults: false,
    tokens,
  };
}
