import { describe, expect, it } from "vitest";

import { tryDirectiveArgumentCompletion } from "../../../src/completion/handlers/directiveArgument";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("tryDirectiveArgumentCompletion", () => {
  it("returns null for non-directive-argument contexts", () => {
    const doc = createDocument("defaults\n    mode h");
    const result = tryDirectiveArgumentCompletion({
      document: doc,
      position: { line: 1, character: 11 } as never,
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: {
        kind: "directive",
        tokenIndex: 0,
        line: { line: 1, section: "defaults", tokens: [] },
      } as never,
      partial: "h",
    });
    expect(result).toBeNull();
  });

  it("returns mode values at directive argument positions", () => {
    const doc = createDocument("defaults\n    mode h");
    const result = tryDirectiveArgumentCompletion({
      document: doc,
      position: { line: 1, character: 11 } as never,
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: {
        kind: "directive-argument",
        tokenIndex: 1,
        line: {
          line: 1,
          section: "defaults",
          tokens: [
            { text: "mode", start: 4, end: 8 },
            { text: "h", start: 9, end: 10 },
          ],
        },
      } as never,
      partial: "h",
    });
    expect(result).not.toBeNull();
    expect(result?.map((item) => item.label)).toEqual(expect.arrayContaining(["http", "haterm"]));
  });
});
