import { describe, expect, it, vi } from "vitest";

import { provideWorkspaceSymbols } from "../../../src/navigation/workspaceSymbols";
import * as symbolIndexModule from "../../../src/symbolIndex";
import {
  clearWorkspaceSymbolIndex,
  scheduleWorkspaceSymbolIndexRebuild,
} from "../../../src/symbolIndex";
import { loadSchema } from "../../helpers/schema";
import { resetMockVscode, setMockWorkspaceFile, Uri } from "../../helpers/vscode";
import { defaultWorkspaceSymbolSettings } from "../workspaceSymbolIndex/helpers";

const schema = loadSchema("3.4");

describe("workspaceSymbols", () => {
  beforeEach(() => {
    resetMockVscode();
    clearWorkspaceSymbolIndex();
  });

  afterEach(() => {
    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns an empty list when the workspace index is missing", () => {
    expect(provideWorkspaceSymbols("api", schema)).toEqual([]);
  });

  it("filters, deduplicates, and maps workspace symbol kinds", () => {
    const uri = Uri.parse("file:///test.cfg");
    const site = {
      kind: "proxy-section" as const,
      name: "api",
      line: 0,
      start: 8,
      end: 11,
      scopeKey: null,
      role: "definition" as const,
      uri,
      uriKey: "file:///test.cfg",
    };
    vi.spyOn(symbolIndexModule, "getWorkspaceSymbolIndexes").mockReturnValue([
      {
        documents: new Map([
          [
            "file:///test.cfg",
            {
              parsed: [
                {
                  line: 0,
                  tokens: [
                    { text: "backend", start: 0, end: 7 },
                    { text: "api", start: 8, end: 11 },
                  ],
                  section: "backend",
                  isSectionHeader: true,
                  anonymousDefaults: false,
                },
              ],
              sectionRangesByStartLine: new Map(),
            },
          ],
          [
            "file:///defaults.cfg",
            {
              parsed: [
                {
                  line: 0,
                  tokens: [
                    { text: "defaults", start: 0, end: 8 },
                    { text: "base", start: 9, end: 13 },
                  ],
                  section: "defaults",
                  isSectionHeader: true,
                  anonymousDefaults: false,
                },
              ],
              sectionRangesByStartLine: new Map(),
            },
          ],
        ]),
        definitions: new Map([
          ["proxy-section:api", [site, { ...site, role: "reference" as const }, site]],
          [
            "defaults-profile:base",
            [
              {
                ...site,
                kind: "defaults-profile" as const,
                name: "base",
                line: 0,
                uriKey: "file:///defaults.cfg",
                uri: Uri.parse("file:///defaults.cfg"),
              },
            ],
          ],
        ]),
        references: [],
        referencesByKey: new Map(),
        folderStates: new Map(),
        settings: defaultWorkspaceSymbolSettings(),
        builtAt: 0,
      } as never,
    ]);

    expect(provideWorkspaceSymbols("", schema).length).toBeGreaterThan(0);
    expect(provideWorkspaceSymbols("api", schema).some((symbol) => symbol.name === "api")).toBe(
      true,
    );
    expect(provideWorkspaceSymbols("zzzz-no-match", schema)).toEqual([]);
  });

  it("lists workspace symbols from a rebuilt workspace index", async () => {
    vi.useFakeTimers();
    setMockWorkspaceFile(
      "file:///test.cfg",
      [
        "defaults base",
        "frontend web from base",
        "    bind :80",
        "backend api",
        "    server s1 127.0.0.1:80",
        "listen both",
        "    bind :81",
      ].join("\n"),
    );
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      defaultWorkspaceSymbolSettings({ debounceMs: 0 }),
      4000,
    );
    await vi.runAllTimersAsync();
    expect(provideWorkspaceSymbols("", schema).length).toBeGreaterThan(0);
    expect(
      provideWorkspaceSymbols("frontend", schema).some((symbol) => symbol.name === "web"),
    ).toBe(true);
    expect(provideWorkspaceSymbols("listen", schema).some((symbol) => symbol.name === "both")).toBe(
      true,
    );
    expect(
      provideWorkspaceSymbols("defaults", schema).some((symbol) => symbol.name === "base"),
    ).toBe(true);
    expect(provideWorkspaceSymbols("api", schema).some((symbol) => symbol.name === "api")).toBe(
      true,
    );
  });
});
