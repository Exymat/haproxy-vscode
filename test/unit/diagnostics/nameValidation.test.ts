import { findInvalidNameChar } from "../../../src/diagnostics/nameValidation";

describe("findInvalidNameChar", () => {
  it("returns empty marker for empty name", () => {
    expect(findInvalidNameChar("")).toBe("");
  });

  it("returns null for valid names", () => {
    expect(findInvalidNameChar("web-frontend_v1.0")).toBeNull();
    expect(findInvalidNameChar("api:8080")).toBeNull();
    expect(findInvalidNameChar("MyBackend123")).toBeNull();
  });

  it("returns first invalid character", () => {
    expect(findInvalidNameChar("web@prod")).toBe("@");
    expect(findInvalidNameChar("foo bar")).toBe(" ");
    expect(findInvalidNameChar("x/y")).toBe("/");
  });
});
