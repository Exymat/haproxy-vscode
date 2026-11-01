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

it("marks parsed declarations and references with semantic roles", () => {
  const doc = createDocument('frontend web\n    acl allowed path /\n    http-request deny unless allowed\nbackend api\n    server s1 127.0.0.1:80');
  const data = provideSemanticTokens(doc, schema, 4000).data;
  let line = 0;
  let start = 0;
  const sites: {text: string; type: number; declaration: boolean}[] = [];
  for (let i = 0; i < data.length; i += 5) {
    start = data[i] === 0 ? start + data[i + 1] : data[i + 1];
    line += data[i];
    sites.push({text: doc.lineAt(line).text.slice(start, start + data[i + 2]), type: data[i + 3], declaration: data[i + 4] === 1});
  }
  expect(sites).toEqual(expect.arrayContaining([
    {text: "web", type: 1, declaration: true},
    {text: "allowed", type: 2, declaration: true},
    {text: "allowed", type: 2, declaration: false},
    {text: "s1", type: 2, declaration: true},
  ]));
});

it("highlights parsed variable declarations and reads", () => {
  const doc = createDocument('frontend web\n    http-request set-var(txn.label) str(test)\n    http-request set-header X-Label %[var(txn.label)]');
  const data = provideSemanticTokens(doc, schema, 4000).data;
  const variables = [];
  for (let i = 0; i < data.length; i += 5) if (data[i + 3] === 3) variables.push(data[i + 4]);
  expect(variables).toContain(1);
  expect(variables).toContain(0);
});
