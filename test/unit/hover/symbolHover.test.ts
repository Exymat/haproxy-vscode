import { trySymbolHover } from "../../../src/hover/handlers/symbolHover";
import { getLineSemanticContext } from "../../../src/lineSemanticContext";
import { createDocument } from "../../helpers/document";
import { hoverText, bundles } from "./helpers";
import type { DocumentContextWithToken, HoverContext } from "../../../src/hover/types";

function context(
  content: string,
  line: number,
  character: number,
  maxSymbolLines?: number,
): HoverContext {
  const document = createDocument(content);
  const bundle = bundles["3.4"];
  const position = { line, character } as never;
  const semantic = getLineSemanticContext(document, position, bundle.schema, bundle.languageData);
  if (!semantic?.ctx.token) {
    throw new Error("symbol hover test requires a token at the cursor");
  }
  const ctx = semantic.ctx as DocumentContextWithToken;
  return {
    document,
    position,
    data: bundle.languageData,
    schema: bundle.schema,
    semantic,
    ctx,
    range: {
      start: { line: ctx.line.line, character: ctx.token.start },
      end: { line: ctx.line.line, character: ctx.token.end },
    } as never,
    cursorOffset: character - ctx.token.start,
    tokenLower: ctx.token.text.toLowerCase(),
    maxSymbolLines,
  };
}

describe("symbol hover", () => {
  it("shows definition, reference count, and peek link for known symbols", () => {
    const content = "backend api\nfrontend web\n    use_backend api";
    const hc = context(content, 2, "    use_backend ".length);
    const hover = trySymbolHover(hc);
    expect(hover).not.toBeNull();
    const text = hoverText(hover as never);
    expect(text).toContain("**Proxy Section 'api'**");
    expect(text).toContain("Defined on line 1.");
    expect(text).toContain("References: 1");
    expect(text).toContain("command:haproxy.peekDefinitionAtPosition");
  });

  it("shows missing definition text without a peek link", () => {
    const content = "frontend web\n    use_backend missing";
    const hc = context(content, 1, "    use_backend ".length);
    const hover = trySymbolHover(hc);
    expect(hover).not.toBeNull();
    const text = hoverText(hover as never);
    expect(text).toContain("No definition found in this file.");
    expect(text).not.toContain("Peek Definition");
  });

  it("returns null when indexing is unavailable or no symbol is under the cursor", () => {
    const content = "backend api\nfrontend web\n    use_backend api";
    expect(trySymbolHover(context(content, 2, "    use_backend ".length, 1))).toBeNull();
    expect(trySymbolHover(context(content, 2, 4))).toBeNull();
  });
});
