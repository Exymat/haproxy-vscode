import { describe, expect, it } from "vitest";

import { getParsedDocumentEntry } from "../../../src/parseCache";
import { sectionHeaderSet } from "../../../src/schema/layout";
import { createDocument, updateDocument } from "../../helpers/document";
import { formatOptionsWithSchema } from "../../helpers/formatOptions";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");
const parseOptions = formatOptionsWithSchema("3.4");

describe("parse cache branch behavior", () => {
  it("reparses suffix when section state no longer matches", () => {
    const doc = createDocument(["defaults", "    mode http", "    timeout client 50s"].join("\n"));
    getParsedDocumentEntry(doc, parseOptions);

    updateDocument(
      doc,
      ["defaults", "    mode http", "frontend web", "    timeout client 50s"].join("\n"),
    );

    expect(getParsedDocumentEntry(doc, parseOptions).parsed[2].section).toBe("frontend");
  });

  it("uses default and explicit section header options", () => {
    expect(getParsedDocumentEntry(createDocument("global\n    daemon")).parsed).toHaveLength(2);
    expect(
      getParsedDocumentEntry(createDocument("global\n    daemon"), {
        sectionHeaders: sectionHeaderSet(bundle.schema),
      }).parsed,
    ).toHaveLength(2);
  });
});
