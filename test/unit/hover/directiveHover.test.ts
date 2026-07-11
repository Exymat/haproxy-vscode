import { describe, expect, it } from "vitest";

import { tryDirectiveHover } from "../../../src/hover/handlers/directiveHover";
import type { DocumentContextWithToken, HoverContext } from "../../../src/hover/types";
import { resolveLanguageKeyword } from "../../../src/language/keywordVariant";
import { analyzeLine } from "../../../src/parser/lineAnalysis";
import type { HaproxyLanguageData, LanguageKeyword } from "../../../src/language/languageData";
import { parseDocument } from "../../helpers/parse";
import { sectionKeywordSet } from "../../../src/schema/keywords";
import { noPrefixKeywordSet, modifierPrefixSet } from "../../../src/schema/tokens";
import { Range } from "../../helpers/vscode";
import { createDocument } from "../../helpers/document";
import { bundles, hoverText } from "./helpers";

function keyword(
  name: string,
  argumentDescription?: string,
  signatures: string[] = [`${name} <value>`],
): LanguageKeyword {
  return {
    name,
    sections: ["backend"],
    signatures,
    description: `${name} docs`,
    docsUrl: "",
    arguments:
      argumentDescription === undefined
        ? undefined
        : [{ parameter: "value", description: argumentDescription, values: [] }],
  };
}

function directiveContext(
  lineTail: string,
  tokenIndex: number,
  directive: HoverContext["semantic"]["directive"],
  data: HaproxyLanguageData,
): HoverContext {
  const schema = bundles["3.4"].schema;
  const document = createDocument(`backend api\n    ${lineTail}`);
  const line = parseDocument(document)[1];
  const lineText = `    ${lineTail}`;
  const token = line.tokens[tokenIndex];
  if (!token) {
    throw new Error("directiveContext requires a token at tokenIndex");
  }
  const position = { line: 1, character: token.start } as never;
  const ctx: DocumentContextWithToken = {
    line,
    lineText,
    tokenIndex,
    token,
    kind: "directive",
    prefix: lineText.slice(0, token.end),
  };
  const allowed = sectionKeywordSet(schema, line.section);
  const analyzed = analyzeLine(line, {
    schema,
    allowed,
    noPrefix: noPrefixKeywordSet(schema),
    modifierPrefixes: modifierPrefixSet(schema),
  });
  const resolvedLanguageKeyword = directive.matched
    ? resolveLanguageKeyword(data.keywords[directive.keyword], line.section)
    : undefined;

  return {
    document,
    position,
    data,
    schema,
    semantic: {
      document,
      position,
      schema,
      data,
      ctx,
      allowed,
      analyzed,
      directive,
      resolvedLanguageKeyword,
    },
    ctx,
    range: new Range(1, token.start, 1, token.end) as never,
    cursorOffset: 0,
    tokenLower: token.text.toLowerCase(),
    analyzed,
  };
}

describe("directive hover handler", () => {
  it("uses prefix-discovered directive docs for incomplete directive spans", () => {
    const data = structuredClone(bundles["3.4"].languageData);
    data.keywords["partial rich"] = keyword("partial rich", "The partial value.");

    const hover = tryDirectiveHover(
      directiveContext(
        "partial rich value",
        2,
        { matched: false, keyword: "partial rich", start: 0, end: 1 },
        data,
      ),
    );

    expect(hover).not.toBeNull();
    if (!hover) {
      throw new Error("expected hover");
    }
    const text = hoverText(hover);
    expect(text).toContain("partial rich");
    expect(text).toContain("**Parameter:** `value`");
    expect(text).toContain("The partial value.");
  });

  it("skips incomplete directive argument hover when parameter docs are sparse", () => {
    const data = structuredClone(bundles["3.4"].languageData);
    data.keywords["partial sparse"] = keyword("partial sparse", "");

    expect(
      tryDirectiveHover(
        directiveContext(
          "partial sparse value",
          2,
          { matched: false, keyword: "partial sparse", start: 0, end: 1 },
          data,
        ),
      ),
    ).toBeNull();
  });

  it("skips matched directive argument hover when parameter docs are sparse", () => {
    const data = structuredClone(bundles["3.4"].languageData);
    data.keywords["matched sparse"] = keyword("matched sparse", "");

    expect(
      tryDirectiveHover(
        directiveContext(
          "matched sparse value",
          2,
          { matched: true, keyword: "matched sparse", start: 0, end: 1 },
          data,
        ),
      ),
    ).toBeNull();
  });

  it("skips directive argument hover when argument metadata is absent", () => {
    const data = structuredClone(bundles["3.4"].languageData);
    data.keywords["matched noargs"] = keyword("matched noargs");
    data.keywords["partial noargs"] = keyword("partial noargs");

    expect(
      tryDirectiveHover(
        directiveContext(
          "matched noargs value",
          2,
          { matched: true, keyword: "matched noargs", start: 0, end: 1 },
          data,
        ),
      ),
    ).toBeNull();
    expect(
      tryDirectiveHover(
        directiveContext(
          "partial noargs value",
          2,
          { matched: false, keyword: "partial noargs", start: 0, end: 1 },
          data,
        ),
      ),
    ).toBeNull();
  });

  it("uses prefix docs while the cursor is inside an attempted directive span", () => {
    const data = structuredClone(bundles["3.4"].languageData);
    data.keywords["prefix token"] = keyword("prefix token");

    const hover = tryDirectiveHover(
      directiveContext(
        "prefix token",
        1,
        { matched: false, keyword: "prefix token", start: 0, end: 1 },
        data,
      ),
    );

    expect(hover).not.toBeNull();
    if (!hover) {
      throw new Error("expected hover");
    }
    expect(hoverText(hover)).toContain("prefix token docs");
  });

  it("falls back to the directive name when directive-token hovers have no signature", () => {
    const data = structuredClone(bundles["3.4"].languageData);
    data.keywords["prefix matched"] = keyword("prefix matched", undefined, []);

    const hover = tryDirectiveHover(
      directiveContext(
        "prefix matched",
        1,
        { matched: true, keyword: "prefix matched", start: 0, end: 1 },
        data,
      ),
    );

    expect(hover).not.toBeNull();
    if (!hover) {
      throw new Error("expected hover");
    }
    expect(hoverText(hover)).toContain("`prefix matched`");
  });

  it("falls back to the directive name when argument hovers have no signature", () => {
    const data = structuredClone(bundles["3.4"].languageData);
    data.keywords["partial nosig"] = keyword("partial nosig", "The partial value.", []);

    const hover = tryDirectiveHover(
      directiveContext(
        "partial nosig value",
        2,
        { matched: false, keyword: "partial nosig", start: 0, end: 1 },
        data,
      ),
    );

    expect(hover).not.toBeNull();
    if (!hover) {
      throw new Error("expected hover");
    }
    expect(hoverText(hover)).toContain("`partial nosig`");
  });
});
