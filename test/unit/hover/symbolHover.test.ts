import { trySymbolHover } from "../../../src/hover/handlers/symbolHover";
import { provideHover } from "../../../src/hover";
import { getLineSemanticContext } from "../../../src/lineSemanticContext";
import * as symbolIndex from "../../../src/symbolIndex";
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
  return contextForDocument(document, line, character, maxSymbolLines);
}

function contextForDocument(
  document: ReturnType<typeof createDocument>,
  line: number,
  character: number,
  maxSymbolLines?: number,
): HoverContext {
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the full section body for proxy-section references", () => {
    const content = "backend api\n    server s1 127.0.0.1:8080\nfrontend web\n    use_backend api";
    const hc = context(content, 3, "    use_backend ".length);
    const hover = trySymbolHover(hc);
    expect(hover).not.toBeNull();
    const text = hoverText(hover as never);
    expect(text).toContain(
      ["```haproxy", "backend api\n    server s1 127.0.0.1:8080", "```"].join("\n"),
    );
    expect(text).toContain("command:haproxy.peekDefinitionAtPosition");
  });

  it("shows the reference line text when the resolved definition site is not a definition role", () => {
    const content = "backend api\nfrontend web\n    use_backend api";
    const hc = context(content, 2, "    use_backend ".length);
    vi.spyOn(symbolIndex, "findDefinitions").mockReturnValue([
      {
        kind: "proxy-section",
        name: "api",
        line: 0,
        start: 8,
        end: 11,
        scopeKey: null,
        role: "reference",
      },
    ]);
    const hover = trySymbolHover(hc);
    expect(hover).not.toBeNull();
    const text = hoverText(hover as never);
    expect(text).toContain(["```haproxy", "backend api", "```"].join("\n"));
  });

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

  it("shows workspace definition previews for cross-file symbol references", () => {
    const frontend = createDocument(
      "frontend web\n    use_backend api",
      "file:///repo/haproxy.d/frontends/web.cfg",
    );
    const backend = createDocument(
      "backend api\n    server s1 127.0.0.1:8080 check",
      "file:///repo/haproxy.d/backends/api.cfg",
    );
    const bundle = bundles["3.4"];
    const workspaceIndex = symbolIndex.buildWorkspaceSymbolIndexFromOpenDocuments(
      [frontend, backend],
      bundle.schema,
      1000,
    );
    vi.spyOn(symbolIndex, "getWorkspaceSymbolIndex").mockReturnValue(workspaceIndex);

    const hover = provideHover(
      frontend,
      { line: 1, character: "    use_backend ".length } as never,
      bundle.languageData,
      bundle.schema,
    );

    const text = hoverText(hover as never);
    expect(text).toContain(
      ["```haproxy", "backend api\n    server s1 127.0.0.1:8080 check", "```"].join("\n"),
    );
    expect(text).not.toContain("Switches the connection to a named backend");
  });

  it("falls back to local symbol hover when the workspace graph is not applicable", () => {
    const content = "backend api\nfrontend web\n    use_backend api";
    const bundle = bundles["3.4"];
    const unrelated = createDocument("backend other", "file:///repo/other.cfg");
    const workspaceIndex = symbolIndex.buildWorkspaceSymbolIndexFromOpenDocuments(
      [unrelated],
      bundle.schema,
      1000,
    );
    vi.spyOn(symbolIndex, "getWorkspaceSymbolIndex").mockReturnValue(workspaceIndex);

    const hover = trySymbolHover(context(content, 2, "    use_backend ".length));

    expect(hoverText(hover as never)).toContain(["```haproxy", "backend api", "```"].join("\n"));
  });

  it("returns null when the workspace graph has no usable cross-file preview", () => {
    const frontend = createDocument(
      "frontend web\n    use_backend api",
      "file:///repo/haproxy.d/frontends/web.cfg",
    );
    const backend = createDocument("backend api", "file:///repo/haproxy.d/backends/api.cfg");
    const bundle = bundles["3.4"];
    const workspaceIndex = symbolIndex.buildWorkspaceSymbolIndexFromOpenDocuments(
      [frontend, backend],
      bundle.schema,
      1000,
    );
    workspaceIndex.documents.delete(symbolIndex.workspaceUriKey(backend.uri));
    vi.spyOn(symbolIndex, "getWorkspaceSymbolIndex").mockReturnValue(workspaceIndex);

    expect(trySymbolHover(contextForDocument(frontend, 1, "    use_backend ".length))).toBeNull();
  });

  it("returns null when a workspace-indexed reference has no definition", () => {
    const document = createDocument(
      "frontend web\n    use_backend missing",
      "file:///repo/haproxy.d/frontends/web.cfg",
    );
    const bundle = bundles["3.4"];
    const workspaceIndex = symbolIndex.buildWorkspaceSymbolIndexFromOpenDocuments(
      [document],
      bundle.schema,
      1000,
    );
    vi.spyOn(symbolIndex, "getWorkspaceSymbolIndex").mockReturnValue(workspaceIndex);

    expect(trySymbolHover(contextForDocument(document, 1, "    use_backend ".length))).toBeNull();
  });

  it("reads workspace site text for references, missing documents, and non-section definitions", () => {
    const content = "frontend web\n    acl is_api path_beg /api\n    use_backend app if is_api";
    const document = createDocument(content, "file:///repo/haproxy.d/frontends/web.cfg");
    const bundle = bundles["3.4"];
    const workspaceIndex = symbolIndex.buildWorkspaceSymbolIndexFromOpenDocuments(
      [document],
      bundle.schema,
      1000,
    );
    const sites = workspaceIndex.references.concat(...workspaceIndex.definitions.values());
    const aclDefinition = sites.find(
      (site) => site.role === "definition" && site.name === "is_api",
    );
    const aclReference = sites.find((site) => site.role === "reference" && site.name === "is_api");
    if (!aclDefinition || !aclReference) {
      throw new Error("expected ACL definition and reference sites");
    }

    expect(symbolIndex.workspaceSiteText(workspaceIndex, aclReference)).toContain("use_backend");
    expect(symbolIndex.workspaceSiteText(workspaceIndex, aclDefinition)).toBe(
      "    acl is_api path_beg /api",
    );
    expect(
      symbolIndex.workspaceSiteText(workspaceIndex, { ...aclDefinition, uriKey: "missing" }),
    ).toBeUndefined();
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
