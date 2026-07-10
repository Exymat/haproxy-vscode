import {
  conditionalBlocksDocsUrl,
  isConditionalOrStatusDirective,
  lookupConditionalDirective,
} from "../../src/conditionalDirectives";
import { loadLanguageData, loadSchema } from "../helpers/schema";

const schema = loadSchema("3.4");
const languageData = loadLanguageData("3.4");

describe("conditionalDirectives", () => {
  it("recognizes conditional block directives", () => {
    expect(isConditionalOrStatusDirective(schema, ".if")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, ".elif")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, ".else")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, ".endif")).toBe(true);
  });

  it("recognizes status directives", () => {
    expect(isConditionalOrStatusDirective(schema, ".diag")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, ".warning")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, "bind")).toBe(false);
    expect(isConditionalOrStatusDirective(schema, undefined)).toBe(false);
  });

  it("looks up directive metadata case-insensitively", () => {
    expect(lookupConditionalDirective(languageData, ".IF")?.name).toBe(".if");
    expect(lookupConditionalDirective(languageData, ".notice")?.signature).toBe(
      '.notice "message"',
    );
    expect(lookupConditionalDirective(languageData, "server")).toBeUndefined();
  });

  it("builds docs URL for version", () => {
    expect(conditionalBlocksDocsUrl(languageData, "3.4")).toBe(
      "https://docs.haproxy.org/3.4/configuration.html#2.4",
    );
  });
});
