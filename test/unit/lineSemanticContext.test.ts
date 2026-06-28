import { keywordNameSetForSection } from "../../src/lineSemanticContext";
import { loadLanguageData } from "../helpers/schema";

describe("lineSemanticContext", () => {
  const data = loadLanguageData("3.2");

  it("keywordNameSetForSection returns empty set for null section", () => {
    expect(keywordNameSetForSection(data, null)).toEqual(new Set());
  });

  it("keywordNameSetForSection returns keyword names for a section", () => {
    expect(keywordNameSetForSection(data, "frontend").size).toBeGreaterThan(0);
  });
});
