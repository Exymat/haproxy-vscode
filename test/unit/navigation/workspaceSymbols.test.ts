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
    expect(provideWorkspaceSymbols("api")).toEqual([]);
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
              firstTokens: ["backend"],
              sectionRangesByStartLine: new Map(),
            },
          ],
          [
            "file:///defaults.cfg",
            {
              firstTokens: ["defaults"],
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

    expect(provideWorkspaceSymbols("").length).toBeGreaterThan(0);
    expect(provideWorkspaceSymbols("api").some((symbol) => symbol.name === "api")).toBe(true);
    expect(provideWorkspaceSymbols("zzzz-no-match")).toEqual([]);
  });

  it("maps symbols whose workspace document entry is missing", () => {
    const uri = Uri.parse("file:///missing.cfg");
    vi.spyOn(symbolIndexModule, "getWorkspaceSymbolIndexes").mockReturnValue([
      {
        documents: new Map(),
        definitions: new Map([
          [
            "proxy-section:orphan",
            [
              {
                kind: "proxy-section" as const,
                name: "orphan",
                line: 0,
                start: 8,
                end: 14,
                scopeKey: null,
                role: "definition" as const,
                uri,
                uriKey: "file:///missing.cfg",
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

    const symbols = provideWorkspaceSymbols("orphan");
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe("orphan");
    expect(symbols[0]?.containerName).toBe("orphan");
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
    expect(provideWorkspaceSymbols("").length).toBeGreaterThan(0);
    expect(provideWorkspaceSymbols("frontend").some((symbol) => symbol.name === "web")).toBe(true);
    expect(provideWorkspaceSymbols("listen").some((symbol) => symbol.name === "both")).toBe(true);
    expect(provideWorkspaceSymbols("defaults").some((symbol) => symbol.name === "base")).toBe(true);
    expect(provideWorkspaceSymbols("api").some((symbol) => symbol.name === "api")).toBe(true);
  });
});
