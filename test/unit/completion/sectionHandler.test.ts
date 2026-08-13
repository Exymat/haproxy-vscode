import { describe, expect, it } from "vitest";

import { trySectionCompletion } from "../../../src/completion/handlers/section";
import { CompletionContext } from "../../../src/completion/types";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

function sectionCompletionContext(partial: string, tokenIndex = 0): CompletionContext {
  const text = partial;
  return {
    document: createDocument(text),
    position: { line: 0, character: text.length } as never,
    data: bundle.languageData,
    schema: bundle.schema,
    ctx: {
      kind: "section",
      tokenIndex,
      prefix: "",
      lineText: text,
      line: {
        line: 0,
        section: null,
        tokens: partial ? [{ text: partial, start: 0, end: partial.length }] : [],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
    } as never,
    partial,
  };
}

describe("trySectionCompletion", () => {
  it("returns all section headers when partial is empty", () => {
    const items = trySectionCompletion(sectionCompletionContext(""));
    expect(items).not.toBeNull();
    expect(items?.map((item) => item.label)).toEqual(
      expect.arrayContaining(["global", "defaults", "frontend", "backend"]),
    );
  });

  it("filters section headers by partial prefix", () => {
    const items = trySectionCompletion(sectionCompletionContext("fron"));
    expect(items?.map((item) => item.label)).toEqual(["frontend"]);
  });

  it("returns null when partial matches no section header", () => {
    expect(trySectionCompletion(sectionCompletionContext("zzzzz"))).toBeNull();
  });

  it("returns null when token index is not zero", () => {
    expect(trySectionCompletion(sectionCompletionContext("global", 1))).toBeNull();
  });

  it("sets detail on completion items", () => {
    const items = trySectionCompletion(sectionCompletionContext("glob"));
    expect(items?.[0]?.detail).toBe("HAProxy section");
  });

  it("suggests the from modifier in section-header-modifier context", () => {
    const items = trySectionCompletion(modifierCompletionContext(""));
    expect(items?.map((item) => item.label)).toEqual(["from"]);
    expect(items?.[0]?.detail).toBe("inherit defaults profile");
  });

  it("filters the from modifier by prefix", () => {
    expect(trySectionCompletion(modifierCompletionContext("fr"))?.map((item) => item.label)).toEqual(
      ["from"],
    );
    expect(trySectionCompletion(modifierCompletionContext("xyz"))).toEqual([]);
  });
});

function modifierCompletionContext(partial: string): CompletionContext {
  return {
    ...sectionCompletionContext(partial, 2),
    ctx: {
      kind: "section-header-modifier",
      tokenIndex: 2,
      prefix: "",
      lineText: `frontend web ${partial}`,
      line: {
        line: 0,
        section: null,
        tokens: [
          { text: "frontend", start: 0, end: 8 },
          { text: "web", start: 9, end: 12 },
        ],
        isSectionHeader: true,
        anonymousDefaults: false,
      },
    } as never,
  };
}
