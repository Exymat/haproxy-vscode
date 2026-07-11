import { describe, expect, it } from "vitest";

import { getDocumentContext } from "../../../src/parser/documentContext";
import { provideHover } from "../../../src/hover";
import { parseDocument } from "../../helpers/parse";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";
import { hoverText } from "./helpers";

const { schema, languageData } = loadSchemaBundle("3.4");

function hoverOnReqHdr(line: string) {
  const content = `frontend web\n${line}`;
  const doc = createDocument(content);
  const lineNo = 1;
  const col = line.indexOf("req.hdr") + 3;
  const parsed = parseDocument(doc);
  const ctx = getDocumentContext(doc, { line: lineNo, character: col } as never, schema);
  const hover = provideHover(doc, { line: lineNo, character: col } as never, languageData, schema);
  return {
    tokens: parsed[lineNo]?.tokens.map((t) => t.text),
    kind: ctx?.kind,
    tokenIndex: ctx?.tokenIndex,
    token: ctx?.token?.text,
    hover: hover ? hoverText(hover) : "",
  };
}

function hoverOnToken(line: string, token: string) {
  const content = `frontend web\n${line}`;
  const doc = createDocument(content);
  const lineNo = 1;
  const col = line.indexOf(token) + Math.min(2, token.length - 1);
  const ctx = getDocumentContext(doc, { line: lineNo, character: col } as never, schema);
  const hover = provideHover(doc, { line: lineNo, character: col } as never, languageData, schema);
  return {
    kind: ctx?.kind,
    tokenIndex: ctx?.tokenIndex,
    token: ctx?.token?.text,
    hover: hover ? hoverText(hover) : "",
  };
}

describe("req.hdr hover on rule action arguments", () => {
  it.each([
    "    http-request set-src req.hdr(X-Forwarded-For)",
    "    http-request set-src-port req.hdr(Client-Port)",
    "    http-request set-var(txn.orgpath) path",
    "    http-request set-var(txn.hostheader) req.hdr(host)",
    "  http-request set-src req.hdr(X-Forwarded-For)",
    "  http-request set-src-port req.hdr(Client-Port)",
    "  http-request set-var(txn.hostheader) req.hdr(host)",
    "  http-request set-var(txn.orgpath) path",
  ])("documents req.hdr on %s", (line) => {
    if (!line.includes("req.hdr")) {
      return;
    }
    const result = hoverOnReqHdr(line);
    expect(result.tokens).toBeDefined();
    expect(result.kind).toBe("http-request");
    expect(result.tokenIndex).toBeGreaterThanOrEqual(2);
    expect(result.hover.toLowerCase()).toContain("req.hdr");
    expect(result.hover.toLowerCase()).not.toContain("immediately rejects");
  });

  it.each([
    "  http-request set-src req.hdr(X-Forwarded-For)",
    "  http-request deny if { req.hdr(host) -m found }",
  ])("does not show http-request directive docs on %s", (line) => {
    const result = hoverOnReqHdr(line);
    expect(result.hover.toLowerCase()).not.toContain("layer 7");
    expect(result.hover.toLowerCase()).not.toContain("immediately rejects");
  });

  it("documents deny action on the action token", () => {
    const line = "  http-request deny if { req.hdr(host) -m found }";
    const content = `frontend web\n${line}`;
    const doc = createDocument(content);
    const lineNo = 1;
    const col = line.indexOf("deny") + 1;
    const hover = provideHover(
      doc,
      { line: lineNo, character: col } as never,
      languageData,
      schema,
    );
    expect(hover ? hoverText(hover).toLowerCase() : "").toContain("deny");
    expect(hover ? hoverText(hover).toLowerCase() : "").toContain("reject");
  });

  it("documents set-src action on the action token", () => {
    const line = "  http-request set-src req.hdr(X-Forwarded-For)";
    const content = `frontend web\n${line}`;
    const doc = createDocument(content);
    const lineNo = 1;
    const col = line.indexOf("set-src") + 2;
    const hover = provideHover(
      doc,
      { line: lineNo, character: col } as never,
      languageData,
      schema,
    );
    expect(hover ? hoverText(hover).toLowerCase() : "").toContain("set-src");
  });

  it("documents both set-var action and req.hdr fetch on the same line", () => {
    const line = "  http-request set-var(txn.hostheader) req.hdr(host)";

    const action = hoverOnToken(line, "set-var");
    expect(action.kind).toBe("http-request");
    expect(action.token).toBe("set-var(txn.hostheader)");
    expect(action.hover.toLowerCase()).toContain("set-var");
    expect(action.hover.toLowerCase()).toContain("variable");
    expect(action.hover.toLowerCase()).not.toContain("access control for layer 7 requests");

    const fetch = hoverOnToken(line, "req.hdr");
    expect(fetch.kind).toBe("http-request");
    expect(fetch.token).toBe("req.hdr(host)");
    expect(fetch.hover.toLowerCase()).toContain("req.hdr");
    expect(fetch.hover.toLowerCase()).toContain("header");
    expect(fetch.hover.toLowerCase()).not.toContain("access control for layer 7 requests");
  });
});
