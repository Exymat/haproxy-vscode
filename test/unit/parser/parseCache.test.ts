import { getParsedDocument, getParsedDocumentEntry } from "../../../src/parser/parseCache";
import { parseDocument } from "../../helpers/parse";
import { createDocument, updateDocument } from "../../helpers/document";
import { parseOptionsWithSchema } from "../../helpers/formatOptions";

const parseOptions = parseOptionsWithSchema("3.2");

describe("getParsedDocument", () => {
  it("parses on cache miss", () => {
    const doc = createDocument("global\n    daemon");
    const parsed = getParsedDocument(doc, parseOptions);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].isSectionHeader).toBe(true);
  });

  it("returns cached parse for same document version", () => {
    const doc = createDocument("defaults\n    mode http");
    const first = getParsedDocument(doc, parseOptions);
    const second = getParsedDocument(doc, parseOptions);
    expect(second).toBe(first);
  });

  it("reparses when document version changes", () => {
    const doc = createDocument("defaults\n    mode http");
    const first = getParsedDocument(doc, parseOptions);
    updateDocument(doc, "defaults\n    mode tcp");
    const second = getParsedDocument(doc, parseOptions);
    expect(second).not.toBe(first);
    expect(parseDocument(doc as never)).toEqual(second);
  });

  it("recognizes healthcheck as a section header", () => {
    const doc = createDocument("healthcheck api\n    tcp-check connect");
    const parsed = parseDocument(doc, "3.4");
    expect(parsed[0].isSectionHeader).toBe(true);
    expect(parsed[0].section).toBe("healthcheck");
    expect(parsed[1].section).toBe("healthcheck");
  });

  it("reuses unchanged suffix lines after a local edit", () => {
    const doc = createDocument(["frontend web", "    bind :80", "    mode http"].join("\n"));
    const first = getParsedDocumentEntry(doc, parseOptions);

    updateDocument(doc, ["frontend web", "    bind :81", "    mode http"].join("\n"));

    const second = getParsedDocumentEntry(doc, parseOptions);
    expect(second.reuse.previousVersion).toBe(first.version);
    expect(second.reuse.prefixLines).toBe(1);
    expect(second.reuse.suffixLines).toBe(1);
    expect(second.parsed[2]).toBe(first.parsed[2]);
  });

  it("reuses full parse when content is identical after version bump", () => {
    const doc = createDocument("global\n    daemon");
    const first = getParsedDocumentEntry(doc, parseOptions);
    updateDocument(doc, "global\n    daemon");
    const second = getParsedDocumentEntry(doc, parseOptions);
    expect(second.parsed).toBe(first.parsed);
    expect(second.reuse.prefixLines).toBe(2);
  });

  it("does not restore a URI parse produced with different section headers", () => {
    const content = "custom-section alpha\n    mode http";
    const firstDoc = createDocument(content, "file:///section-header-options.cfg");
    const customOptions = { sectionHeaders: new Set(["custom-section"]) };

    const first = getParsedDocumentEntry(firstDoc, customOptions);
    expect(first.parsed[0].isSectionHeader).toBe(true);
    expect(first.parsed[1].section).toBe("custom-section");

    const reopened = createDocument(content, firstDoc.uri.toString());
    const second = getParsedDocumentEntry(reopened, { sectionHeaders: new Set(["backend"]) });

    expect(second.parsed).not.toBe(first.parsed);
    expect(second.parsed[0].isSectionHeader).toBe(false);
    expect(second.parsed[1].section).toBeNull();
    expect(firstDoc.version).toBe(1);
    expect(reopened.version).toBe(1);
  });

  it("reparses from start when the first line changes", () => {
    const doc = createDocument("global\n    daemon");
    getParsedDocumentEntry(doc, parseOptions);
    updateDocument(doc, "defaults\n    daemon");
    const second = getParsedDocumentEntry(doc, parseOptions);
    expect(second.parsed[0].section).toBe("defaults");
    expect(second.reuse.prefixLines).toBe(0);
  });

  it("clones suffix parsed lines with updated line numbers when lines are inserted", () => {
    const doc = createDocument(["frontend web", "    mode http", "    bind :80"].join("\n"));
    const first = getParsedDocumentEntry(doc, parseOptions);
    updateDocument(
      doc,
      ["frontend web", "    # inserted", "    mode http", "    bind :80"].join("\n"),
    );
    const second = getParsedDocumentEntry(doc, parseOptions);
    expect(second.reuse.suffixLines).toBe(2);
    expect(second.parsed[3].line).toBe(3);
    expect(second.parsed[3].tokens).toEqual(first.parsed[2].tokens);
  });

  it("reparses suffix when parse state no longer matches for suffix reuse", () => {
    const doc = createDocument(
      ["defaults", "    mode http", "    # comment", "    timeout client 50s"].join("\n"),
    );
    getParsedDocumentEntry(doc, parseOptions);
    updateDocument(
      doc,
      ["defaults", "    mode http", "frontend web", "    timeout client 50s"].join("\n"),
    );
    const second = getParsedDocumentEntry(doc, parseOptions);
    expect(second.reuse.suffixLines).toBe(0);
    expect(second.parsed[2].section).toBe("frontend");
  });
});
