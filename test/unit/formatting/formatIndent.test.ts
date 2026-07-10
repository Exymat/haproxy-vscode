import {
  formatIndentToOptions,
  isFormatIndent,
  legacyFormatIndent,
} from "../../../src/formatIndent";
import { formatConfig } from "../../../src/formatter";
import { formatOptionsWithSchema } from "../../helpers/formatOptions";

describe("formatIndentToOptions", () => {
  it("maps indent settings", () => {
    expect(formatIndentToOptions("spaces-4")).toEqual({ indentStyle: "spaces", indentSize: 4 });
    expect(formatIndentToOptions("spaces-2")).toEqual({ indentStyle: "spaces", indentSize: 2 });
    expect(formatIndentToOptions("tab")).toEqual({ indentStyle: "tab", indentSize: 4 });
  });
});

describe("isFormatIndent", () => {
  it("accepts known indent values", () => {
    expect(isFormatIndent("spaces-4")).toBe(true);
    expect(isFormatIndent("spaces-2")).toBe(true);
    expect(isFormatIndent("tab")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isFormatIndent("spaces-8")).toBe(false);
    expect(isFormatIndent("")).toBe(false);
    expect(isFormatIndent("invalid")).toBe(false);
  });
});

describe("legacyFormatIndent", () => {
  it("maps legacy settings", () => {
    expect(legacyFormatIndent("tab", 4)).toBe("tab");
    expect(legacyFormatIndent("spaces", 2)).toBe("spaces-2");
    expect(legacyFormatIndent("spaces", 4)).toBe("spaces-4");
  });
});

describe("formatConfig with spaces-2", () => {
  it("normalizes two-space indent", () => {
    const result = formatConfig("frontend web\n      bind :443", {
      ...formatOptionsWithSchema("3.2"),
      ...formatIndentToOptions("spaces-2"),
    });
    expect(result).toBe("frontend web\n  bind :443");
  });
});
