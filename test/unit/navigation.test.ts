import { provideDefinition, provideReferences } from "../../src/navigation";
import { parseDocument } from "../../src/parser";
import * as symbolIndex from "../../src/symbolIndex";
import {
  buildSymbolIndex,
  resolveSymbolAtPosition,
  findDefinitions,
  findAllSites,
} from "../../src/symbolIndex";
import { loadSchema } from "../helpers/schema";
import { createDocument } from "../helpers/document";

const schema = loadSchema("3.2");

function pos(line: number, character: number) {
  return { line, character } as never;
}

function assertDef(
  index: ReturnType<typeof buildSymbolIndex>,
  kind: Parameters<typeof findDefinitions>[1],
  name: string,
  scopeKey: string | null,
  line: number,
  start: number,
) {
  const defs = findDefinitions(index, kind, name, scopeKey);
  const hit = defs.find((d) => d.line === line && d.start === start);
  expect(hit).toBeDefined();
}

function assertRefCount(
  index: ReturnType<typeof buildSymbolIndex>,
  kind: Parameters<typeof findAllSites>[1],
  name: string,
  scopeKey: string | null,
  count: number,
) {
  const sites = findAllSites(index, kind, name, scopeKey);
  expect(sites.length).toBe(count);
}

function assertResolve(
  doc: ReturnType<typeof createDocument>,
  position: never,
  expected: { kind: string; name: string; scopeKey: string | null } | null,
) {
  expect(resolveSymbolAtPosition(doc as never, position, schema)).toEqual(expected);
}

function runCase(
  content: string,
  checks: (ctx: {
    doc: ReturnType<typeof createDocument>;
    index: ReturnType<typeof buildSymbolIndex>;
  }) => void,
) {
  const doc = createDocument(content);
  const parsed = parseDocument(doc);
  const index = buildSymbolIndex(parsed, schema);
  checks({ doc, index });
}

describe("navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("backend use_backend", () => {
    runCase(
      "backend api\n    server s1 127.0.0.1:8080\nfrontend web\n    use_backend api",
      ({ doc, index }) => {
        assertDef(index, "proxy-section", "api", null, 0, "backend api".indexOf("api"));
        assertRefCount(index, "proxy-section", "api", null, 2);
        const useBackendCol = "    use_backend api".indexOf("api");
        assertResolve(doc, pos(3, useBackendCol), {
          kind: "proxy-section",
          name: "api",
          scopeKey: null,
        });
      },
    );
  });

  it("server use-server", () => {
    runCase(
      "backend api\n    server web1 127.0.0.1:8080\n    use-server web1",
      ({ doc, index }) => {
        const serverCol = "    server web1".indexOf("web1");
        assertDef(index, "server", "web1", "backend:api", 1, serverCol);
        assertRefCount(index, "server", "web1", "backend:api", 2);
        const useServerCol = "    use-server web1".indexOf("web1");
        assertResolve(doc, pos(2, useServerCol), {
          kind: "server",
          name: "web1",
          scopeKey: "backend:api",
        });
      },
    );
  });

  it("acl if reference", () => {
    runCase(
      "frontend web\n    acl is_api path -m beg /api\n    http-request deny if is_api",
      ({ doc, index }) => {
        const aclCol = "    acl is_api".indexOf("is_api");
        assertDef(index, "acl", "is_api", "frontend:web", 1, aclCol);
        assertRefCount(index, "acl", "is_api", "frontend:web", 2);
        const ifCol = "    http-request deny if is_api".indexOf("is_api");
        assertResolve(doc, pos(2, ifCol), {
          kind: "acl",
          name: "is_api",
          scopeKey: "frontend:web",
        });
      },
    );
  });

  it("acl negated if reference", () => {
    runCase(
      "frontend web\n    acl is_api path -m beg /api\n    http-request deny if !is_api",
      ({ doc, index }) => {
        assertRefCount(index, "acl", "is_api", "frontend:web", 2);
        const ifCol = "    http-request deny if !is_api".indexOf("is_api");
        assertResolve(doc, pos(2, ifCol), {
          kind: "acl",
          name: "is_api",
          scopeKey: "frontend:web",
        });
      },
    );
  });

  it("acl && compound if reference", () => {
    runCase(
      "frontend web\n    acl is_api path -m beg /api\n    acl is_admin path -m beg /admin\n    http-request deny if is_api && is_admin",
      ({ doc, index }) => {
        assertRefCount(index, "acl", "is_api", "frontend:web", 2);
        assertRefCount(index, "acl", "is_admin", "frontend:web", 2);
        const adminCol = "    http-request deny if is_api && is_admin".lastIndexOf("is_admin");
        assertResolve(doc, pos(3, adminCol), {
          kind: "acl",
          name: "is_admin",
          scopeKey: "frontend:web",
        });
      },
    );
  });

  it("acl || compound if reference", () => {
    runCase(
      "frontend web\n    acl is_api path -m beg /api\n    acl is_admin path -m beg /admin\n    http-request deny if is_api || is_admin",
      ({ doc, index }) => {
        assertRefCount(index, "acl", "is_admin", "frontend:web", 2);
        const adminCol = "    http-request deny if is_api || is_admin".lastIndexOf("is_admin");
        assertResolve(doc, pos(3, adminCol), {
          kind: "acl",
          name: "is_admin",
          scopeKey: "frontend:web",
        });
      },
    );
  });

  it("acl compound if reference with negation", () => {
    runCase(
      "frontend web\n    acl is_api path -m beg /api\n    acl is_admin path -m beg /admin\n    http-request deny if is_api && !is_admin",
      ({ doc, index }) => {
        assertRefCount(index, "acl", "is_admin", "frontend:web", 2);
        const adminCol = "    http-request deny if is_api && !is_admin".lastIndexOf("is_admin");
        assertResolve(doc, pos(3, adminCol), {
          kind: "acl",
          name: "is_admin",
          scopeKey: "frontend:web",
        });
      },
    );
  });

  it("filter definition", () => {
    runCase("backend api\n    filter compression\n        compression algo gzip", ({ index }) => {
      const filterCol = "    filter compression".indexOf("compression");
      assertDef(index, "filter", "compression", "backend:api", 1, filterCol);
    });
  });

  it("name-scopes defaults from", () => {
    runCase(
      "defaults profile_default from fusion_defaults\ndefaults fusion_defaults\n    mode http",
      ({ doc, index }) => {
        const fusionCol = "defaults fusion_defaults".indexOf("fusion_defaults");
        assertDef(index, "defaults-profile", "fusion_defaults", null, 1, fusionCol);
        const fromCol = "defaults profile_default from fusion_defaults".indexOf("fusion_defaults");
        assertRefCount(index, "defaults-profile", "fusion_defaults", null, 2);
        assertResolve(doc, pos(0, fromCol), {
          kind: "defaults-profile",
          name: "fusion_defaults",
          scopeKey: null,
        });
      },
    );
  });

  it("name-scopes frontend from", () => {
    runCase(
      "defaults profile_default\nfrontend FRONTEND_PRD from profile_default",
      ({ doc, index }) => {
        const profileCol = "defaults profile_default".indexOf("profile_default");
        assertDef(index, "defaults-profile", "profile_default", null, 0, profileCol);
        const fromCol = "frontend FRONTEND_PRD from profile_default".indexOf("profile_default");
        assertResolve(doc, pos(1, fromCol), {
          kind: "defaults-profile",
          name: "profile_default",
          scopeKey: null,
        });
      },
    );
  });

  it("cache section", () => {
    runCase(
      "cache maintenance_cache\n    total-max-size 4\ndefaults\n    mode http",
      ({ index }) => {
        const cacheCol = "cache maintenance_cache".indexOf("maintenance_cache");
        assertDef(index, "cache", "maintenance_cache", null, 0, cacheCol);
      },
    );
  });

  it("provideDefinition returns null without definitions", () => {
    const doc = createDocument("frontend web\n    bind :80");
    const col = "    bind :80".indexOf("bind");
    expect(provideDefinition(doc as never, pos(1, col), schema, 4000)).toBeNull();
  });

  it("provideDefinition returns null for indexed references without definitions", () => {
    const doc = createDocument("frontend web\n    use_backend missing");
    const col = "    use_backend missing".indexOf("missing");
    expect(provideDefinition(doc as never, pos(1, col), schema, 4000)).toBeNull();
  });

  it("provideDefinition returns a LocationLink spanning the section for proxy-section", () => {
    const doc = createDocument(
      "backend api\n    server s1 127.0.0.1:8080\nfrontend web\n    use_backend api",
    );
    const col = "    use_backend api".indexOf("api");
    const location = provideDefinition(doc, pos(3, col), schema, 4000);
    expect(Array.isArray(location)).toBe(true);
    expect(location).not.toBeNull();
    const link = (location as unknown[])[0] as {
      targetRange: { start: { line: number }; end: { line: number } };
      targetSelectionRange: { start: { line: number; character: number } };
    };
    expect(link.targetRange.start.line).toBe(0);
    expect(link.targetRange.end.line).toBe(1);
    expect(link.targetSelectionRange.start.character).toBe("backend api".indexOf("api"));
  });

  it("provideDefinition returns Location[] for multiple non-link definition targets", () => {
    const doc = createDocument("backend api\nfrontend web\n    use_backend api");
    const col = "    use_backend api".indexOf("api");
    vi.spyOn(symbolIndex, "findSiteAtPosition").mockReturnValue({
      kind: "proxy-section",
      name: "api",
      line: 2,
      start: col,
      end: col + 3,
      scopeKey: null,
      role: "reference",
    });
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
    const location = provideDefinition(doc, pos(2, col), schema, 4000);
    expect(Array.isArray(location)).toBe(true);
    expect((location as unknown[]).length).toBe(2);
    expect((location as unknown[])[0]).not.toHaveProperty("targetUri");
  });

  it("provideDefinition returns a single LocationLink when exactly one section definition exists", () => {
    const doc = createDocument("backend api\nfrontend web\n    use_backend api");
    const col = "    use_backend api".indexOf("api");
    const location = provideDefinition(doc, pos(2, col), schema, 4000);
    expect(Array.isArray(location)).toBe(true);
    expect(location).not.toBeNull();
    expect((location as unknown[]).length).toBe(1);
  });

  it("provideDefinition works at every character in a symbol reference", () => {
    const doc = createDocument("backend api\nfrontend web\n    use_backend api");
    const col = "    use_backend api".indexOf("api");
    for (let offset = 0; offset <= "api".length; offset += 1) {
      const location = provideDefinition(doc, pos(2, col + offset), schema, 4000);
      expect(location).not.toBeNull();
    }
  });

  it("provideDefinition falls back to parser resolution when exact site lookup misses", () => {
    const doc = createDocument("backend api\nfrontend web\n    use_backend api");
    const col = "    use_backend api".indexOf("api");
    vi.spyOn(symbolIndex, "findSiteAtPosition").mockReturnValueOnce(null);
    const location = provideDefinition(doc, pos(2, col), schema, 4000);
    expect(location).not.toBeNull();
    expect(Array.isArray(location)).toBe(true);
  });

  it("provideDefinition returns null when indexing is unavailable or no definitions remain", () => {
    const doc = createDocument("frontend web\n    use_backend api");
    const col = "    use_backend api".indexOf("api");
    vi.spyOn(symbolIndex, "getSymbolIndex").mockReturnValueOnce(null);
    expect(provideDefinition(doc as never, pos(1, col), schema, 4000)).toBeNull();

    vi.spyOn(symbolIndex, "getSymbolIndex").mockReturnValueOnce({
      definitions: new Map(),
      references: [],
      referencesByKey: new Map(),
      scopeKeyByLine: [null, null],
      scopedSymbolKinds: symbolIndex.scopedSymbolKindSet(schema),
      sitesByLine: [[], []],
      unresolvedReferences: [],
    });
    vi.spyOn(symbolIndex, "findSiteAtPosition").mockReturnValueOnce({
      kind: "proxy-section",
      name: "api",
      line: 1,
      start: 16,
      end: 19,
      scopeKey: null,
      role: "reference",
    });
    vi.spyOn(symbolIndex, "findDefinitions").mockReturnValueOnce([]);
    expect(provideDefinition(doc as never, pos(1, col), schema, 4000)).toBeNull();
  });

  it("provideReferences returns empty without sites", () => {
    const doc = createDocument("frontend web\n    bind :80");
    const col = "    bind :80".indexOf("bind");
    expect(
      provideReferences(doc as never, pos(1, col), { includeDeclaration: true }, schema, 4000),
    ).toEqual([]);
  });

  it("provideReferences returns empty when symbol has no sites", () => {
    const doc = createDocument("frontend web\n    use_backend api");
    const col = "    use_backend api".indexOf("api");
    vi.spyOn(symbolIndex, "findSiteAtPosition").mockReturnValue({
      kind: "proxy-section",
      name: "api",
      line: 1,
      start: 16,
      end: 19,
      scopeKey: null,
      role: "reference",
    });
    vi.spyOn(symbolIndex, "findDefinitions").mockReturnValue([]);
    vi.spyOn(symbolIndex, "findReferences").mockReturnValue([]);
    expect(
      provideReferences(doc as never, pos(1, col), { includeDeclaration: true }, schema, 4000),
    ).toEqual([]);
  });

  it("resolves section header references and fallback scopes directly", () => {
    const doc = createDocument(
      "defaults profile_default\nfrontend FRONTEND_PRD from profile_default",
    );
    const fromCol = "frontend FRONTEND_PRD from profile_default".indexOf("profile_default");
    expect(resolveSymbolAtPosition(doc as never, pos(1, fromCol), schema)).toEqual({
      kind: "defaults-profile",
      name: "profile_default",
      scopeKey: null,
    });
  });

  it("handles empty lines, out-of-token positions, and direct helper fallbacks", () => {
    const doc = createDocument("frontend web\n    bind :80");
    expect(resolveSymbolAtPosition(doc as never, pos(5, 0), schema)).toBeNull();
    expect(resolveSymbolAtPosition(doc as never, pos(1, 0), schema)).toBeNull();

    const index = {
      definitions: new Map(),
      references: [],
      referencesByKey: new Map(),
      scopeKeyByLine: [null],
    };
    expect(findDefinitions(index as never, "acl", "missing", null)).toEqual([]);
    expect(findAllSites(index as never, "acl", "missing", null)).toEqual([]);
  });
});
