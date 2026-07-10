import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: readFileSyncMock,
  };
});

import { clearLanguageDataCache, loadLanguageData } from "../../src/languageData";
import { clearSchemaCache, loadSchema } from "../../src/schema/load";
import { createTempSchemaFixture } from "../helpers/tempSchema";

describe("sync load non-Error failures", () => {
  let fixture = createTempSchemaFixture("haproxy-sync-nonerror-", {});

  beforeEach(() => {
    clearLanguageDataCache();
    clearSchemaCache();
    fixture = createTempSchemaFixture("haproxy-sync-nonerror-", {
      "haproxy-3.4.language.json": "{}",
      "haproxy-3.4.schema.json": "{}",
    });
    readFileSyncMock.mockImplementation((path: string) => {
      if (String(path).includes("haproxy-3.4")) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercises non-Error sync failure path
        throw "sync failure";
      }
      throw new Error(`Unexpected readFileSync path: ${path}`);
    });
  });

  afterEach(() => {
    readFileSyncMock.mockReset();
    fixture.cleanup();
  });

  it("wraps sync load failures from non-Error throws", () => {
    expect(() =>
      loadLanguageData({ extensionPath: fixture.extensionPath } as never, "3.4"),
    ).toThrow(/sync failure/);
    expect(() => loadSchema({ extensionPath: fixture.extensionPath } as never, "3.4")).toThrow(
      /sync failure/,
    );
  });
});
