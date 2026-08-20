import { describe, expect, it, vi } from "vitest";

import { provideSemanticTokens } from "../../../src/navigation/semanticTokens";
import * as symbolIndexModule from "../../../src/symbolIndex";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");

describe("semanticTokens", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("highlights backend references", () => {
    const doc = createDocument(
      "frontend web\n    use_backend api\nbackend api\n    server s1 127.0.0.1:80",
    );
    const tokens = provideSemanticTokens(doc, schema, 4000);
    expect(tokens.data.length).toBeGreaterThan(0);
  });

  it("skips oversized documents, missing indexes, and non-backend proxy refs", () => {
    const doc = createDocument(
      [
        "frontend web",
        "    use_backend api",
        "    default_backend",
        "    http-request cache-use shared",
        "backend api",
        "cache shared",
        "    total-max-size 1",
      ].join("\n"),
    );
    expect(provideSemanticTokens(doc, schema, 1).data.length).toBe(0);
    expect(provideSemanticTokens(doc, schema, 4000).data.length).toBeGreaterThan(0);

    vi.spyOn(symbolIndexModule, "getSymbolIndex").mockReturnValueOnce(null);
    expect(provideSemanticTokens(doc, schema, 4000).data.length).toBe(0);

    vi.spyOn(symbolIndexModule, "getSymbolIndex").mockReturnValueOnce({
      definitions: new Map(),
      references: [
        {
          kind: "proxy-section",
          name: "api",
          line: 3,
          start: 16,
          end: 19,
          scopeKey: null,
          role: "reference",
        },
      ],
      referencesByKey: new Map(),
      scopeKeyByLine: [],
      scopedSymbolKinds: new Set(),
      sitesByLine: [],
      unresolvedReferences: [],
    });
    expect(provideSemanticTokens(doc, schema, 4000).data.length).toBe(0);
  });
});
