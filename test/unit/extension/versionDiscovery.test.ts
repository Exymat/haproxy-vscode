import { afterEach, describe, expect, it, vi } from "vitest";

describe("version discovery fallback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("fs");
  });

  it("uses bundled defaults when schema files are unavailable", async () => {
    vi.doMock("fs", () => ({
      readdirSync: () => {
        throw new Error("missing schemas");
      },
    }));
    const version = await import("../../../src/version");
    expect(version.SUPPORTED_HAPROXY_VERSIONS).toEqual(["2.6", "2.8", "3.0", "3.2", "3.4"]);
  });
});
