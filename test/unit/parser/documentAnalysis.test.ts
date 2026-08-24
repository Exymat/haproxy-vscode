import { describe, expect, it } from "vitest";

import {
  clearDocumentAnalysisCache,
  getDocumentAnalysis,
} from "../../../src/parser/documentAnalysis";
import { createDocument, updateDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";

describe("getDocumentAnalysis cache", () => {
  const schema = loadSchema("3.2");

  it("reuses analysis for the same document version and schema", () => {
    const doc = createDocument("frontend web\n    mode http");
    const first = getDocumentAnalysis(doc, schema);
    const second = getDocumentAnalysis(doc, schema);
    expect(second).toBe(first);
  });

  it("rebuilds analysis after document version changes", () => {
    const doc = createDocument("frontend web\n    mode http");
    const first = getDocumentAnalysis(doc, schema);
    updateDocument(doc, "frontend web\n    mode tcp");
    const second = getDocumentAnalysis(doc, schema);
    expect(second).not.toBe(first);
  });

  it("rebuilds analysis after cache invalidation", () => {
    const doc = createDocument("frontend web\n    mode http");
    const first = getDocumentAnalysis(doc, schema);
    clearDocumentAnalysisCache();
    const second = getDocumentAnalysis(doc, schema);
    expect(second).not.toBe(first);
  });
});
