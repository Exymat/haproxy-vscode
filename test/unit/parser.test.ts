import { parseDocument, tokenizeLine } from "../../src/parser";
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
    const parsed = parseDocument(doc as never);
    expect(parsed[0].anonymousDefaults).toBe(true);
    expect(parsed[1].anonymousDefaults).toBe(true);
  });

  it("parses named defaults without anonymous flag", () => {
    const doc = createDocument("defaults my-profile\n    maxconn 100");
    const parsed = parseDocument(doc as never);
    expect(parsed[0].anonymousDefaults).toBe(false);
  });
});
