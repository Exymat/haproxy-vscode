import { describe, expect, it } from "vitest";

import { UriLruCache } from "../../../src/uriLruCache";

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
