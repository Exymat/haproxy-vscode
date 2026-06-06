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
  expect(hit, `expected definition ${kind}/${name} at line ${line} col ${start}`).toBeDefined();
}

function assertRefCount(
  index: ReturnType<typeof buildSymbolIndex>,
  kind: Parameters<typeof findAllSites>[1],
  name: string,
  scopeKey: string | null,
  count: number,
) {
  const sites = findAllSites(index, kind, name, scopeKey);
  expect(sites.length, `expected ${count} sites for ${kind}/${name}`).toBe(count);
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
  const parsed = parseDocument(doc as never);
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

  it("acl negated if reference spaced", () => {
    runCase(
      "frontend web\n    acl is_api path -m beg /api\n    http-request deny if ! is_api",
      ({ doc, index }) => {
        assertRefCount(index, "acl", "is_api", "frontend:web", 2);
        const ifCol = "    http-request deny if ! is_api".indexOf("is_api");
        assertResolve(doc, pos(2, ifCol), {
          kind: "acl",
          name: "is_api",
          scopeKey: "frontend:web",
        });
      },
    );
  });

  it("acl negated if reference compact", () => {
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
    vi.spyOn(symbolIndex, "resolveSymbolAtPosition").mockReturnValue({
      kind: "proxy-section",
      name: "api",
      scopeKey: null,
    });
    vi.spyOn(symbolIndex, "findAllSites").mockReturnValue([]);
    expect(
      provideReferences(doc as never, pos(1, col), { includeDeclaration: true }, schema, 4000),
    ).toEqual([]);
  });
});
