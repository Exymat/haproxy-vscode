import { parseDocument, tokenizeLine, DEFAULT_SECTION_HEADERS } from "../../src/parser";
import { createDocument } from "../helpers/document";

describe("tokenizeLine", () => {
  it("handles escaped characters inside double quotes", () => {
    expect(tokenizeLine('set-header X "a\\"b"')).toEqual([
      { text: "set-header", start: 0, end: 10 },
      { text: "X", start: 11, end: 12 },
      { text: '"a\\"b"', start: 13, end: 19 },
    ]);
  });

  it("stops at inline comment when not inside a token", () => {
    expect(tokenizeLine("mode http # trailing")).toEqual([
      { text: "mode", start: 0, end: 4 },
      { text: "http", start: 5, end: 9 },
    ]);
  });

  it("parses anonymous defaults section header", () => {
    const doc = createDocument("defaults\n    maxconn 100");
    const parsed = parseDocument(doc);
    expect(parsed[0].anonymousDefaults).toBe(true);
    expect(parsed[1].anonymousDefaults).toBe(true);
  });

  it("parses named defaults without anonymous flag", () => {
    const doc = createDocument("defaults my-profile\n    maxconn 100");
    const parsed = parseDocument(doc);
    expect(parsed[0].anonymousDefaults).toBe(false);
  });

  it("uses provided section headers", () => {
    const doc = createDocument("custom-section my-block\n    mode http");
    const parsed = parseDocument(doc, { sectionHeaders: new Set(["custom-section"]) });
    expect(parsed[0].isSectionHeader).toBe(true);
    expect(parsed[0].section).toBe("custom-section");
  });

  it("uses default section headers when options are omitted", () => {
    const doc = createDocument("frontend web\n    mode http");
    const parsed = parseDocument(doc, { sectionHeaders: DEFAULT_SECTION_HEADERS });
    expect(parsed[0].isSectionHeader).toBe(true);
  });
});
