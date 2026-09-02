import { describe, expect, it } from "vitest";

import { UriLruCache } from "../../../src/core/uriLruCache";

describe("UriLruCache", () => {
  it("evicts the oldest entry when capacity is exceeded", () => {
    const cache = new UriLruCache<string>(2);
    cache.set("a", "1", "A");
    cache.set("b", "1", "B");
    cache.get("a", "1");
    cache.set("c", "1", "C");

    expect(cache.get("b", "1")).toBeUndefined();
    expect(cache.get("a", "1")).toBe("A");
    expect(cache.get("c", "1")).toBe("C");
  });

  it("keeps the previous fingerprint after a same-URI overwrite", () => {
    const cache = new UriLruCache<string>(2);
    cache.set("a", "v1", "one");
    cache.set("a", "v2", "two");

    expect(cache.get("a", "v2")).toBe("two");
    expect(cache.get("a", "v1")).toBe("one");

    cache.set("a", "v3", "three");
    expect(cache.get("a", "v3")).toBe("three");
    expect(cache.get("a", "v2")).toBe("two");
    expect(cache.get("a", "v1")).toBeUndefined();
  });

  it("reports whether a URI key is present without a fingerprint", () => {
    const cache = new UriLruCache<string>(2);
    cache.set("a", "1", "A");
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    cache.delete("a");
    expect(cache.has("a")).toBe(false);
  });

  it("supports delete and clear", () => {
    const cache = new UriLruCache<string>(2);
    cache.set("a", "1", "A");
    cache.delete("a");
    expect(cache.get("a", "1")).toBeUndefined();

    cache.set("b", "1", "B");
    cache.clear();
    expect(cache.get("b", "1")).toBeUndefined();
  });
});
