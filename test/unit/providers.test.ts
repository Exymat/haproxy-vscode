import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { provideDocumentSymbols } from "../../src/documentSymbols";
import { createBundleLoader, invalidateBundleLoad } from "../../src/extensionBundle";
import { provideFoldingRanges } from "../../src/folding";
import { provideDefinition, provideReferences } from "../../src/navigation";
import * as languageData from "../../src/languageData";
import * as schemaModule from "../../src/schema/load";
import { createDocument } from "../helpers/document";
import { mockExtensionContext } from "../helpers/extensionContext";
import { loadSchema, loadSchemaBundle } from "../helpers/schema";

const schema = loadSchema("3.2");
const bundle = loadSchemaBundle("3.2");

beforeEach(async () => {
  invalidateBundleLoad();
  vi.spyOn(schemaModule, "loadSchemaAsync").mockResolvedValue(bundle.schema);
  vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(bundle.languageData);
  const { ensureBundle } = createBundleLoader(mockExtensionContext() as never);
  await ensureBundle("3.2");
});

afterEach(() => {
  invalidateBundleLoad();
  vi.restoreAllMocks();
});

function pos(line: number, character: number) {
  return { line, character } as never;
}

describe("provideDocumentSymbols", () => {
  it("returns vscode document symbols for sections", () => {
    const doc = createDocument("global\n    daemon\n\ndefaults\n    mode http");
    const symbols = provideDocumentSymbols(doc);
    expect(symbols.map((s) => s.name)).toEqual(["global", "defaults"]);
    expect(symbols[0].kind).toBe(1);
  });
});

describe("provideFoldingRanges", () => {
  it("returns folding ranges for section bodies", () => {
    const doc = createDocument(
      "frontend web\n    bind :80\nbackend api\n    server s1 127.0.0.1:8080",
    );
    const ranges = provideFoldingRanges(doc);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[0].start).toBe(0);
  });
});

describe("provideDefinition", () => {
  it("returns null when document exceeds max lines", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => (i === 0 ? "global" : "    # pad"));
    const doc = createDocument(lines.join("\n"));
    expect(provideDefinition(doc as never, pos(0, 0), schema, 4000)).toBeNull();
  });

  it("returns null when no symbol at position", () => {
    const doc = createDocument("global\n    daemon");
    expect(provideDefinition(doc as never, pos(1, 2), schema, 4000)).toBeNull();
  });

  it("returns a LocationLink spanning the full section for proxy-section definitions", () => {
    const doc = createDocument(
      "backend api\n    server s1 127.0.0.1:8080\nfrontend web\n    use_backend api",
    );
    const useBackendCol = "    use_backend api".indexOf("api");
    const location = provideDefinition(doc, pos(3, useBackendCol), schema, 4000);
    expect(location).not.toBeNull();
    expect(Array.isArray(location)).toBe(true);
    const link = (location as unknown[])[0] as {
      targetRange: { start: { line: number }; end: { line: number } };
      targetSelectionRange: { start: { line: number; character: number } };
    };
    expect(link.targetRange.start.line).toBe(0);
    expect(link.targetRange.end.line).toBe(1);
    expect(link.targetSelectionRange.start.line).toBe(0);
    expect(link.targetSelectionRange.start.character).toBe("backend api".indexOf("api"));
  });

  it("returns a plain Location for in-section symbol definitions", () => {
    const doc = createDocument("backend api\n    server s1 127.0.0.1:8080\n    use-server s1");
    const useServerCol = "    use-server s1".indexOf("s1");
    const location = provideDefinition(doc, pos(2, useServerCol), schema, 4000);
    expect(location).not.toBeNull();
    expect(Array.isArray(location)).toBe(false);
    expect("range" in (location as object)).toBe(true);
    expect((location as { range: { start: { line: number } } }).range.start.line).toBe(1);
  });

  it("returns multiple LocationLinks for duplicate section names", () => {
    const doc = createDocument(
      "backend api\n    server s1 127.0.0.1:8080\nbackend api\n    server s2 127.0.0.1:8081\nfrontend web\n    use_backend api",
    );
    const useBackendCol = "    use_backend api".indexOf("api");
    const locations = provideDefinition(doc, pos(5, useBackendCol), schema, 4000);
    expect(Array.isArray(locations)).toBe(true);
    expect((locations as unknown[]).length).toBe(2);
    for (const location of locations as Array<{
      targetRange: { start: { line: number }; end: { line: number } };
    }>) {
      expect(location.targetRange.end.line).toBeGreaterThan(location.targetRange.start.line);
    }
  });
});

describe("provideReferences", () => {
  it("returns empty array when index is unavailable", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => (i === 0 ? "global" : "    # pad"));
    const doc = createDocument(lines.join("\n"));
    expect(
      provideReferences(doc as never, pos(0, 0), { includeDeclaration: true }, schema, 4000),
    ).toEqual([]);
  });

  it("includes declaration sites when requested", () => {
    const doc = createDocument(
      "backend api\n    server s1 127.0.0.1:8080\nfrontend web\n    use_backend api",
    );
    const useBackendCol = "    use_backend api".indexOf("api");
    const refs = provideReferences(
      doc,
      pos(3, useBackendCol),
      { includeDeclaration: true },
      schema,
      4000,
    );
    expect(refs.length).toBe(2);
  });

  it("excludes declaration sites when includeDeclaration is false", () => {
    const doc = createDocument(
      "backend api\n    server s1 127.0.0.1:8080\nfrontend web\n    use_backend api",
    );
    const useBackendCol = "    use_backend api".indexOf("api");
    const refs = provideReferences(
      doc,
      pos(3, useBackendCol),
      { includeDeclaration: false },
      schema,
      4000,
    );
    expect(refs.length).toBe(1);
    expect(refs[0].range.start.line).toBe(3);
  });
});
