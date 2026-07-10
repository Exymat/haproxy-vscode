import { computeDiagnostics } from "../../../src/diagnostics";
import { hasWarmUriDocumentCache } from "../../../src/documentCache";
import { getParsedDocumentEntry, hasUriParseCache } from "../../../src/parseCache";
import { getSymbolIndex } from "../../../src/symbolIndex";
import { hasUriSymbolIndexCache } from "../../../src/symbolIndex/cache";
import { createDocument } from "../../helpers/document";
import { parseOptionsWithSchema } from "../../helpers/formatOptions";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");
const parseOptions = parseOptionsWithSchema("3.4");

describe("uri document caches", () => {
  it("restores parse and symbol caches after close and reopen with the same content", () => {
    const firstDoc = createDocument("backend api\n    server s1 127.0.0.1:80");
    getParsedDocumentEntry(firstDoc, parseOptions);
    getSymbolIndex(firstDoc, schema, 4000);

    const reopened = createDocument(
      "backend api\n    server s1 127.0.0.1:80",
      firstDoc.uri.toString(),
    );

    expect(hasUriParseCache(reopened)).toBe(true);
    expect(hasUriSymbolIndexCache(reopened)).toBe(true);
    expect(hasWarmUriDocumentCache(reopened)).toBe(true);

    const parseEntry = getParsedDocumentEntry(reopened, parseOptions);
    expect(parseEntry.parsed).toHaveLength(2);
    const index = getSymbolIndex(reopened, schema, 4000);
    expect(index?.definitions.size).toBeGreaterThan(0);
  });

  it("restores diagnostics from the uri cache on reopen", () => {
    const firstDoc = createDocument("backend api\n    server s1 127.0.0.1:80");
    const options = {
      unusedSymbols: false,
      missingReferences: true,
      maxLines: 4000,
    };
    const first = computeDiagnostics(firstDoc, schema, options);

    const reopened = createDocument(
      "backend api\n    server s1 127.0.0.1:80",
      firstDoc.uri.toString(),
    );
    const second = computeDiagnostics(reopened, schema, options);

    expect(second).toEqual(first);
  });

  it("hits the uri diagnostics cache when suppressDeprecated matches", () => {
    const content = "backend api\n    server s1 127.0.0.1:80";
    const firstDoc = createDocument(content);
    const options = {
      deprecatedWarnings: true,
      unusedSymbols: false,
      missingReferences: false,
      maxLines: 4000,
    };
    const first = computeDiagnostics(firstDoc, schema, options);

    const reopened = createDocument(content, firstDoc.uri.toString());
    expect(
      computeDiagnostics(reopened, schema, { ...options, deprecatedWarnings: false }),
    ).not.toBe(first);
    expect(computeDiagnostics(reopened, schema, options)).toEqual(first);
  });
});
