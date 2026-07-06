import { trySymbolHover } from "../../../src/hover/handlers/symbolHover";
import { provideHover } from "../../../src/hover";
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
  it("shows the definition line for known symbol references", () => {
    const content = "backend api\nfrontend web\n    use_backend api";
    const hc = context(content, 2, "    use_backend ".length);
    const hover = trySymbolHover(hc);
    expect(hover).not.toBeNull();
    const text = hoverText(hover as never);
    expect(text).toContain(["```haproxy", "backend api", "```"].join("\n"));
    expect(text).toContain("command:haproxy.peekDefinitionAtPosition");
    expect(text).not.toContain("Defined on line");
    expect(text).not.toContain("References:");
  });

  it("returns null when a symbol reference has no definition", () => {
    const content = "frontend web\n    use_backend missing";
    const hc = context(content, 1, "    use_backend ".length);
    expect(trySymbolHover(hc)).toBeNull();
  });

  it("returns null when indexing is unavailable, no symbol is under the cursor, or the cursor is on a definition", () => {
    const content = "backend api\nfrontend web\n    use_backend api";
    expect(trySymbolHover(context(content, 2, "    use_backend ".length, 1))).toBeNull();
    expect(trySymbolHover(context(content, 2, "    ".length))).toBeNull();
    expect(
      trySymbolHover(context("frontend web\n    acl is_api path /api", 1, "    acl ".length)),
    ).toBeNull();
  });

  it("takes priority over directive argument hover on symbol references", () => {
    const content = "backend api\nfrontend web\n    use_backend api";
    const bundle = bundles["3.4"];
    const hover = provideHover(
      createDocument(content),
      { line: 2, character: "    use_backend ".length } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(hoverText(hover as never)).toContain(["```haproxy", "backend api", "```"].join("\n"));
  });

  it("shows the definition line for default_backend references", () => {
    const content = "backend api\nfrontend web\n    default_backend api";
    const bundle = bundles["3.4"];
    const hover = provideHover(
      createDocument(content),
      { line: 2, character: "    default_backend ".length } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(hoverText(hover as never)).toContain(["```haproxy", "backend api", "```"].join("\n"));
  });

  it("shows peek definition for chained acl references around inline expressions", () => {
    const content =
      "frontend web\n    acl acl_name_1 path_beg /a1\n    acl acl_name_2 path_beg /a2\n    http-request deny if !acl_name_1 acl_name_2 { dst_port -m int 80 } || !acl_name_1";
    const lineText = content.split(/\r?\n/)[3];
    const bundle = bundles["3.4"];

    for (const [needle, definition] of [
      ["acl_name_1", "    acl acl_name_1 path_beg /a1"],
      ["acl_name_2", "    acl acl_name_2 path_beg /a2"],
    ] as const) {
      const hover = provideHover(
        createDocument(content),
        { line: 3, character: lineText.indexOf(needle) } as never,
        bundle.languageData,
        bundle.schema,
      );
      const text = hoverText(hover as never);
      expect(text).toContain(["```haproxy", definition, "```"].join("\n"));
      expect(text).toContain("command:haproxy.peekDefinitionAtPosition");
    }
  });
});
