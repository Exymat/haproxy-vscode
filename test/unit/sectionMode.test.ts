import { getParsedDocumentEntry, ParsedDocumentReuse } from "../../src/parseCache";
import { parseDocument } from "../../src/parser";
import { runtimeModeForDocument, runtimeModeForLine } from "../../src/sectionMode";
import { createDocument, updateDocument } from "../helpers/document";

function craftedReuse(overrides: Partial<ParsedDocumentReuse>): ParsedDocumentReuse {
  return {
    previousVersion: 1,
    prefixLines: 0,
    suffixLines: 0,
    oldSuffixStart: 0,
    newSuffixStart: 0,
    ...overrides,
  };
}

describe("sectionMode", () => {
  it("resolves inherited runtime mode from defaults", () => {
    const doc = createDocument(
      ["defaults", "    mode http", "frontend web", "    bind :80"].join("\n"),
    );
    const entry = getParsedDocumentEntry(doc);
    const modes = runtimeModeForLine(entry.parsed);
    expect(modes[2]).toBe("http");
  });

  it("reuses cached modes when edited lines do not touch mode or sections", () => {
    const parsed = parseDocument(
      createDocument(["defaults", "    timeout connect 5s", "backend api"].join("\n")),
    );
    const cached = runtimeModeForDocument(parsed, 1, craftedReuse({ previousVersion: null }));

    const result = runtimeModeForDocument(
      parsed,
      2,
      craftedReuse({ prefixLines: 1, suffixLines: 2, newSuffixStart: 2 }),
      cached,
    );
    expect(result.modes).toBe(cached.modes);
    expect(result.version).toBe(2);
  });

  it("recomputes modes when a mode line changes in the edited region", () => {
    const before = parseDocument(
      createDocument(["defaults", "    mode http", "backend api"].join("\n")),
    );
    const cached = runtimeModeForDocument(before, 1, craftedReuse({ previousVersion: null }));

    const after = parseDocument(
      createDocument(["defaults", "    mode tcp", "backend api"].join("\n")),
    );
    const result = runtimeModeForDocument(
      after,
      2,
      craftedReuse({ prefixLines: 1, suffixLines: 2, newSuffixStart: 2 }),
      cached,
    );
    expect(result.modes).not.toBe(cached.modes);
    expect(result.modes[1]).toBe("tcp");
  });

  it("reuses modes when entire document is unchanged", () => {
    const doc = createDocument(["defaults", "    mode http"].join("\n"));
    const entry1 = getParsedDocumentEntry(doc);
    const cached = runtimeModeForDocument(entry1.parsed, doc.version, entry1.reuse);

    updateDocument(doc, ["defaults", "    mode http"].join("\n"));
    const entry2 = getParsedDocumentEntry(doc);
    const result = runtimeModeForDocument(entry2.parsed, doc.version, entry2.reuse, cached);
    expect(result.modes).toBe(cached.modes);
  });

  it("recomputes modes when suffix reuse is incomplete", () => {
    const doc = createDocument(["defaults", "    mode http", "    timeout connect 5s"].join("\n"));
    const entry1 = getParsedDocumentEntry(doc);
    const cached = runtimeModeForDocument(entry1.parsed, doc.version, entry1.reuse);

    updateDocument(doc, ["defaults", "    mode http", "    timeout connect 10s"].join("\n"));
    const entry2 = getParsedDocumentEntry(doc);
    const result = runtimeModeForDocument(entry2.parsed, doc.version, entry2.reuse, cached);
    expect(result.modes).not.toBe(cached.modes);
    expect(result.modes[1]).toBe("http");
  });

  it("recomputes modes when a section header changes in the edited region", () => {
    const before = parseDocument(
      createDocument(["defaults", "    mode http", "backend api"].join("\n")),
    );
    const cached = runtimeModeForDocument(before, 1, craftedReuse({ previousVersion: null }));

    const after = parseDocument(
      createDocument(["defaults", "    mode http", "frontend web"].join("\n")),
    );
    const result = runtimeModeForDocument(
      after,
      2,
      craftedReuse({ prefixLines: 1, suffixLines: 2, newSuffixStart: 2 }),
      cached,
    );
    expect(result.modes).not.toBe(cached.modes);
    expect(result.modes[2]).toBe("http");
  });
});
