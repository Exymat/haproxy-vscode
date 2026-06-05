import { findInvalidNameChar, looksLikeListenAddress } from "../../src/nameValidation";

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

describe("looksLikeListenAddress", () => {
  it("returns false for empty or non-address tokens", () => {
    expect(looksLikeListenAddress("")).toBe(false);
    expect(looksLikeListenAddress("   ")).toBe(false);
    expect(looksLikeListenAddress("web-frontend")).toBe(false);
    expect(looksLikeListenAddress("/var/run/haproxy.sock")).toBe(false);
  });

  it("detects colon-prefixed listen forms", () => {
    expect(looksLikeListenAddress(":443")).toBe(true);
    expect(looksLikeListenAddress("*:80")).toBe(true);
    expect(looksLikeListenAddress(":::443")).toBe(true);
  });

  it("detects host:port and ipv6:port forms", () => {
    expect(looksLikeListenAddress("127.0.0.1:8080")).toBe(true);
    expect(looksLikeListenAddress("[::1]:443")).toBe(true);
    expect(looksLikeListenAddress("fe80::1:8080")).toBe(true);
  });

  it("detects hostname:port without leading digit", () => {
    expect(looksLikeListenAddress("localhost:8080")).toBe(true);
  });

  it("does not treat numeric-leading tokens as addresses when colon rules fail", () => {
    expect(looksLikeListenAddress("8080:extra")).toBe(false);
  });
});
