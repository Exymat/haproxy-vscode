import { describe, expect, it } from "vitest";

import { clearRuntimeModeCache } from "../../../src/diagnostics/diagnosticContext";
import {
  getDocumentSession,
  getSymbolIndex,
  getSymbolIndexVersion,
} from "../../../src/document/session";
import { getLiveSession, persistDocumentSession } from "../../../src/document/sessionStore";
import { clearParseCache, getParsedDocumentEntry } from "../../../src/parser/parseCache";
import { createDocument, updateDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");

describe("document session", () => {
  it("builds parse, analysis, modes, and symbols together", () => {
    const document = createDocument("backend api\n    server s1 127.0.0.1:80");
    const session = getDocumentSession(document, schema);
    expect(session.parse.parsed).toHaveLength(2);
    expect(session.analysis.parsed).toBe(session.parse.parsed);
    expect(session.modes.modes).toHaveLength(2);
    expect(session.branches).toHaveLength(2);
    expect(session.hasLuaLoad).toBe(false);
    expect(session.symbols?.definitions.get("proxy-section:api")).toHaveLength(1);
    expect(session.symbolLineFingerprints).toHaveLength(2);
  });

  it("reuses a live session on a second lookup", () => {
    const document = createDocument("frontend web\n    bind :80");
    const first = getDocumentSession(document, schema, 4000);
    const second = getDocumentSession(document, schema, 4000);
    expect(second.parse).toBe(first.parse);
    expect(second.analysis).toBe(first.analysis);
    expect(second.symbols).toBe(first.symbols);
  });

  it("returns undefined from getSymbolIndexVersion when only parse has been cached", () => {
    const document = createDocument("defaults\n    mode http");
    expect(getSymbolIndexVersion(document)).toBeUndefined();
    getParsedDocumentEntry(document);
    expect(getSymbolIndexVersion(document)).toBeUndefined();
    expect(getSymbolIndex(document, schema, 4000)).not.toBeNull();
    expect(getSymbolIndexVersion(document)).toBe(document.version);
  });

  it("ignores persistDocumentSession when the document has no live session", () => {
    const document = createDocument("global\n    daemon");
    persistDocumentSession(document, "unused-fingerprint");
    expect(getSymbolIndexVersion(document)).toBeUndefined();
  });

  it("ignores persistDocumentSession when the live session map is empty", () => {
    const document = createDocument("defaults\n    mode http");
    expect(getLiveSession(document, "missing-options")).toBeUndefined();
    persistDocumentSession(document, "unused-fingerprint");
    expect(getSymbolIndexVersion(document)).toBeUndefined();
  });

  it("clears parse and runtime-mode session caches", () => {
    const document = createDocument("backend api\n    server s1 127.0.0.1:80");
    const first = getDocumentSession(document, schema);
    clearParseCache();
    const afterParseClear = getDocumentSession(document, schema);
    expect(afterParseClear.analysis).not.toBe(first.analysis);
    clearRuntimeModeCache();
    const afterModeClear = getDocumentSession(document, schema);
    expect(afterModeClear.analysis).not.toBe(afterParseClear.analysis);
  });

  it("skips the symbol index when the document exceeds maxSymbolLines", () => {
    const document = createDocument("backend api\n    server s1 127.0.0.1:80");
    const session = getDocumentSession(document, schema, 1);
    expect(session.symbols).toBeNull();
    expect(getSymbolIndex(document, schema, 1)).toBeNull();
  });

  it("rebuilds session-derived symbols after a single-line edit", () => {
    const document = createDocument("backend api\n    server s1 127.0.0.1:80");
    const first = getDocumentSession(document, schema);
    updateDocument(document, "backend api\n    server s1 127.0.0.1:8080");
    const second = getDocumentSession(document, schema);
    expect(second.parse).not.toBe(first.parse);
    expect(second.symbols).not.toBeNull();
  });
});
