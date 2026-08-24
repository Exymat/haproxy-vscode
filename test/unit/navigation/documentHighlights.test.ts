import { describe, expect, it } from "vitest";
import * as vscode from "vscode";

import { provideDocumentHighlights } from "../../../src/navigation/documentHighlights";
import { cursorAtToken } from "../../helpers/cursor";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");

describe("documentHighlights", () => {
  it("highlights symbol references under the cursor", () => {
    const content = "backend api\nfrontend web\n    use_backend api";
    const doc = createDocument(content);
    const highlights = provideDocumentHighlights(
      doc,
      cursorAtToken(content, 2, "api", 1),
      schema,
      4000,
    );
    expect(highlights.length).toBeGreaterThan(0);
    expect(
      highlights.some((highlight) => highlight.kind === vscode.DocumentHighlightKind.Write),
    ).toBe(true);
    expect(
      highlights.some((highlight) => highlight.kind === vscode.DocumentHighlightKind.Read),
    ).toBe(true);
  });

  it("returns an empty list when no symbol is under the cursor", () => {
    const content = "frontend web\n    bind :80";
    const doc = createDocument(content);
    expect(provideDocumentHighlights(doc, cursorAtToken(content, 1, "bind"), schema, 4000)).toEqual(
      [],
    );
  });

  it("marks non-section definitions as writes", () => {
    const content = [
      "frontend web",
      "    acl blocked path_beg /admin",
      "    http-request deny if blocked",
    ].join("\n");
    const highlights = provideDocumentHighlights(
      createDocument(content),
      cursorAtToken(content, 2, "blocked"),
      schema,
      4000,
    );
    expect(highlights.map((highlight) => highlight.kind)).toEqual(
      expect.arrayContaining([
        vscode.DocumentHighlightKind.Write,
        vscode.DocumentHighlightKind.Read,
      ]),
    );
  });

  it("keeps unresolved references readable when no definition exists", () => {
    const content = "frontend web\n    use_backend missing";
    const highlights = provideDocumentHighlights(
      createDocument(content),
      cursorAtToken(content, 1, "missing"),
      schema,
      4000,
    );
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.kind).toBe(vscode.DocumentHighlightKind.Read);
  });
});
