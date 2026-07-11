import { describe, expect, it, vi } from "vitest";

import * as extensionBundle from "../../../src/extension/extensionBundle";
import { provideDocumentSymbols } from "../../../src/navigation/documentSymbols";
import { provideFoldingRanges } from "../../../src/navigation/folding";
import { createDocument } from "../../helpers/document";

describe("outline provider fallback branch behavior", () => {
  it("returns empty results when no schema bundle is loaded", () => {
    vi.spyOn(extensionBundle, "getLoadedBundleForUri").mockReturnValue(undefined);
    const outlineDoc = createDocument("global\n    daemon");

    expect(provideDocumentSymbols(outlineDoc)).toEqual([]);
    expect(provideFoldingRanges(outlineDoc)).toEqual([]);

    vi.restoreAllMocks();
  });
});
