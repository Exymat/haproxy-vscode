import { afterEach, describe, expect, it, vi } from "vitest";

describe("version discovery fallback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("fs");
  });

  it("discovers and sorts schema versions when schema files are available", async () => {
    vi.doMock("fs", () => ({
      readdirSync: (directory: string) =>
        directory.endsWith("syntaxes")
          ? [
              "haproxy-2.6.tmLanguage.json",
              "haproxy-2.8.tmLanguage.json",
              "haproxy-3.0.tmLanguage.json",
              "haproxy-3.2.tmLanguage.json",
              "haproxy-3.4.tmLanguage.json",
              "haproxy-2.8r1.tmLanguage.json",
              "haproxy-3.2r1.tmLanguage.json",
            ]
          : [
              "README.md",
              "haproxy-3.4.schema.json",
              "haproxy-3.4.language.json",
              "haproxy-2.8.schema.json",
              "haproxy-2.8.language.json",
              "haproxy-3.0.language.json",
              "haproxy-2.6.schema.json",
              "haproxy-2.6.language.json",
              "haproxy-3.2.schema.json",
              "haproxy-3.2.language.json",
              "haproxy-3.0.schema.json",
              "haproxy-3.2r1.schema.json",
              "haproxy-3.2r1.language.json",
              "haproxy-2.8r1.schema.json",
              "haproxy-2.8r1.language.json",
              "haproxy-3.0r1.schema.json",
              "haproxy-3.0r1.language.json",
              "hapee-3.2.overlay.json",
            ],
    }));

    const version = await import("../../../src/extension/version");

    expect(version.SUPPORTED_HAPROXY_VERSIONS).toEqual(["2.6", "2.8", "3.0", "3.2", "3.4"]);
    expect(version.HAPEE_SCHEMA_VERSIONS).toEqual(["2.8", "3.2"]);
    expect(version.DEFAULT_HAPROXY_VERSION).toBe("3.2");
  });

  it("uses the newest discovered schema version when the preferred default is absent", async () => {
    vi.doMock("fs", () => ({
      readdirSync: (directory: string) =>
        directory.endsWith("syntaxes")
          ? ["haproxy-3.4.tmLanguage.json", "haproxy-2.10.tmLanguage.json"]
          : [
              "haproxy-3.4.schema.json",
              "haproxy-3.4.language.json",
              "haproxy-2.10.schema.json",
              "haproxy-2.10.language.json",
            ],
    }));

    const version = await import("../../../src/extension/version");

    expect(version.SUPPORTED_HAPROXY_VERSIONS).toEqual(["2.10", "3.4"]);
    expect(version.DEFAULT_HAPROXY_VERSION).toBe("3.4");
    expect(version.HAPEE_SCHEMA_VERSIONS).toEqual([]);
  });

  it("uses bundled defaults when schema files are unavailable", async () => {
    vi.doMock("fs", () => ({
      readdirSync: () => {
        throw new Error("missing schemas");
      },
    }));
    const version = await import("../../../src/extension/version");
    expect(version.SUPPORTED_HAPROXY_VERSIONS).toEqual(["2.6", "2.8", "3.0", "3.2", "3.4"]);
    expect(version.HAPEE_SCHEMA_VERSIONS).toEqual(["2.6", "2.8", "3.0", "3.2"]);
  });
});
