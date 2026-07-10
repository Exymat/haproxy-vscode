import { getLineSemanticContext, keywordNameSetForSection } from "../../../src/lineSemanticContext";
import { createDocument } from "../../helpers/document";
import { loadLanguageData, loadSchemaBundle } from "../../helpers/schema";

describe("lineSemanticContext", () => {
  const data = loadLanguageData("3.2");
  const { schema } = loadSchemaBundle("3.4");

  it("getLineSemanticContext returns null when document context is null", () => {
    const doc = createDocument("frontend web");
    expect(
      getLineSemanticContext(
        doc,
        { line: 0, character: "frontend web".indexOf("web") } as never,
        schema,
      ),
    ).toBeNull();
  });

  it("keywordNameSetForSection returns empty set for null section", () => {
    expect(keywordNameSetForSection(data, null)).toEqual(new Set());
  });

  it("keywordNameSetForSection returns keyword names for a section", () => {
    expect(keywordNameSetForSection(data, "frontend").size).toBeGreaterThan(0);
  });
});
