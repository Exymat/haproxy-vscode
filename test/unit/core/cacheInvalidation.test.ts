import { describe, expect, it } from "vitest";

import { invalidateAllExtensionCaches } from "../../../src/extension/cacheInvalidation";
import {
  clearDocumentAnalysisCache,
  getDocumentAnalysis,
} from "../../../src/parser/documentAnalysis";
import {
  finalizeParseCacheForClosedDocument,
  getParsedDocumentEntry,
  hasUriParseCache,
} from "../../../src/parser/parseCache";
import { createDocument } from "../../helpers/document";
import { parseOptionsWithSchema } from "../../helpers/formatOptions";
import { loadSchema } from "../../helpers/schema";
import { mockTextDocuments } from "../../helpers/vscode";

describe("invalidateAllExtensionCaches", () => {
  const schema = loadSchema("3.2");
  const parseOptions = parseOptionsWithSchema("3.2");

  it("clears parse and analysis caches after bundle reload", () => {
    mockTextDocuments.length = 0;
    const doc = createDocument(
      "backend api\n    server s1 127.0.0.1:80",
      "file:///cache-clear.cfg",
    );
    mockTextDocuments.push(doc as never);

    const analysis = getDocumentAnalysis(doc, schema);
    getParsedDocumentEntry(doc, parseOptions);
    mockTextDocuments.length = 0;
    finalizeParseCacheForClosedDocument(doc);

    const reopened = createDocument("backend api\n    server s1 127.0.0.1:80", doc.uri.toString());
    expect(hasUriParseCache(reopened)).toBe(true);

    invalidateAllExtensionCaches();

    expect(hasUriParseCache(reopened)).toBe(false);
    expect(getDocumentAnalysis(reopened, schema)).not.toBe(analysis);
    clearDocumentAnalysisCache();
  });
});
