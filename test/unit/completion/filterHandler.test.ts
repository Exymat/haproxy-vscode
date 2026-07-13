import { describe, expect, it } from "vitest";

import { tryFilterCompletion } from "../../../src/completion/handlers/filter";
import { CompletionContext } from "../../../src/completion/types";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

function filterCompletionContext(partial = ""): CompletionContext {
  const text = `    filter ${partial}`;
  const tokenStart = 11;
  return {
    document: createDocument(`frontend web\n${text}`),
    position: { line: 1, character: text.length } as never,
    data: bundle.languageData,
    schema: bundle.schema,
    ctx: {
      kind: "filter",
      tokenIndex: 1,
      line: {
        line: 1,
        text,
        indent: 4,
        section: "frontend",
        tokens: [
          { text: "filter", start: 4, end: 10 },
          { text: partial, start: tokenStart, end: tokenStart + partial.length },
        ],
      },
    } as never,
    partial,
  };
}

describe("tryFilterCompletion", () => {
  it("returns null for non-filter contexts", () => {
    const cc = filterCompletionContext();
    cc.ctx = { ...cc.ctx, kind: "directive" };
    expect(tryFilterCompletion(cc)).toBeNull();
  });

  it("returns known filter names", () => {
    const items = tryFilterCompletion(filterCompletionContext("comp"));
    expect(items).not.toBeNull();
    expect(items?.map((item) => item.label)).toEqual(
      expect.arrayContaining(["compression", "comp-req"]),
    );
  });
});
