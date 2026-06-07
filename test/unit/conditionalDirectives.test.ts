import {
  conditionalBlocksDocsUrl,
  isConditionalOrStatusDirective,
  lookupConditionalDirective,
} from "../../src/conditionalDirectives";

describe("conditionalDirectives", () => {
  it("recognizes conditional block directives", () => {
    expect(isConditionalOrStatusDirective(".if")).toBe(true);
    expect(isConditionalOrStatusDirective(".elif")).toBe(true);
    expect(isConditionalOrStatusDirective(".else")).toBe(true);
    expect(isConditionalOrStatusDirective(".endif")).toBe(true);
  });

  it("recognizes status directives", () => {
    expect(isConditionalOrStatusDirective(".diag")).toBe(true);
    expect(isConditionalOrStatusDirective(".warning")).toBe(true);
    expect(isConditionalOrStatusDirective("bind")).toBe(false);
    expect(isConditionalOrStatusDirective(undefined)).toBe(false);
  });

  it("looks up directive metadata case-insensitively", () => {
    expect(lookupConditionalDirective(".IF")?.name).toBe(".if");
    expect(lookupConditionalDirective(".notice")?.signature).toBe('.notice "message"');
    expect(lookupConditionalDirective("server")).toBeUndefined();
  });

  it("builds docs URL for version", () => {
    expect(conditionalBlocksDocsUrl("3.4")).toBe(
      "https://docs.haproxy.org/3.4/configuration.html#2.4",
    );
  });
});
