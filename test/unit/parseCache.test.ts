import { getParsedDocument } from "../../src/parseCache";
import { parseDocument } from "../../src/parser";
import { createDocument } from "../helpers/document";

describe("getParsedDocument", () => {
  it("parses on cache miss", () => {
    const doc = createDocument("global\n    daemon");
    const parsed = getParsedDocument(doc as never);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].isSectionHeader).toBe(true);
  });

  it("returns cached parse for same document version", () => {
    const doc = createDocument("defaults\n    mode http");
    const first = getParsedDocument(doc as never);
    const second = getParsedDocument(doc as never);
    expect(second).toBe(first);
  });

  it("reparses when document version changes", () => {
    const doc = createDocument("defaults\n    mode http");
    const first = getParsedDocument(doc as never);
    (doc as unknown as { version: number }).version = 2;
    const second = getParsedDocument(doc as never);
    expect(second).not.toBe(first);
    expect(parseDocument(doc as never)).toEqual(second);
  });
});
