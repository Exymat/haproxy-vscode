import { getParsedDocument } from "../../src/parseCache";
import { parseDocument } from "../../src/parser";
import { createDocument } from "../helpers/document";

describe("getParsedDocument", () => {
  it("parses on cache miss", () => {
    const doc = createDocument("global\n    daemon");
    const parsed = getParsedDocument(doc);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].isSectionHeader).toBe(true);
  });

  it("returns cached parse for same document version", () => {
    const doc = createDocument("defaults\n    mode http");
    const first = getParsedDocument(doc);
    const second = getParsedDocument(doc);
    expect(second).toBe(first);
  });

  it("reparses when document version changes", () => {
    const doc = createDocument("defaults\n    mode http");
    const first = getParsedDocument(doc);
    (doc as unknown as { version: number }).version = 2;
    const second = getParsedDocument(doc);
    expect(second).not.toBe(first);
    expect(parseDocument(doc as never)).toEqual(second);
  });

  it("recognizes healthcheck as a section header", () => {
    const doc = createDocument("healthcheck api\n    tcp-check connect");
    const parsed = parseDocument(doc);
    expect(parsed[0].isSectionHeader).toBe(true);
    expect(parsed[0].section).toBe("healthcheck");
    expect(parsed[1].section).toBe("healthcheck");
  });
});
