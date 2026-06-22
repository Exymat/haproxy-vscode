import { parseDocument } from "../../src/parser";
import {
  buildSymbolIndex,
  findAllSites,
  findDefinitions,
  findReferences,
  getSymbolIndex,
  resolveSymbolAtPosition,
  symbolKey,
} from "../../src/symbolIndex";
import { createDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";
import type { Position, TextDocument } from "vscode";

const schema = loadSchema("3.4");

function pos(line: number, character: number) {
  return { line, character } as Position;
}

function doc(content: string): TextDocument {
  return createDocument(content);
}

describe("symbolIndex extended", () => {
  it("buildSymbolIndex tracks global sections without proxy scope", () => {
    const parsed = parseDocument(doc("global\n    daemon\ncache c1\n    total-max-size 4"));
    const index = buildSymbolIndex(parsed, schema);
    expect(index.definitions.get("cache:c1")?.length).toBe(1);
    expect(index.references.length).toBe(0);
  });

  it("buildSymbolIndex handles single-token section headers", () => {
    const parsed = parseDocument(doc("global\n    daemon"));
    const index = buildSymbolIndex(parsed, schema);
    expect(index.definitions.get("proxy-section:global")).toBeUndefined();
    expect(index.references.length).toBe(0);
  });

  it("getSymbolIndex caches by document version", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const first = getSymbolIndex(document, schema, 4000);
    const second = getSymbolIndex(document, schema, 4000);
    expect(first).toBe(second);
    expect(first?.definitions.get("proxy-section:api")?.length).toBe(1);
  });

  it("getSymbolIndex returns null above max lines", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => (i === 0 ? "global" : "    # pad"));
    const document = doc(lines.join("\n"));
    expect(getSymbolIndex(document, schema, 4000)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null without tokens", () => {
    const document = doc("global\n    # comment");
    expect(resolveSymbolAtPosition(document, pos(1, 2), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null off token", () => {
    const document = doc("global\n    daemon");
    expect(resolveSymbolAtPosition(document, pos(1, 0), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition resolves statement rule definitions", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const serverCol = "    server s1".indexOf("s1");
    expect(resolveSymbolAtPosition(document, pos(1, serverCol), schema)).toEqual({
      kind: "server",
      name: "s1",
      scopeKey: "backend:api",
    });
  });

  it("resolveSymbolAtPosition resolves defaults from references", () => {
    const document = doc("defaults profile_a\nfrontend web from profile_a");
    const fromCol = "frontend web from profile_a".indexOf("profile_a");
    expect(resolveSymbolAtPosition(document, pos(1, fromCol), schema)).toEqual({
      kind: "defaults-profile",
      name: "profile_a",
      scopeKey: null,
    });
  });

  it("resolveSymbolAtPosition returns null for unknown tokens in scope", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    expect(resolveSymbolAtPosition(document, pos(1, 6), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null for unsupported section headers", () => {
    const document = doc("mailers smtp\n    mailer m1 127.0.0.1:25");
    expect(resolveSymbolAtPosition(document, pos(0, 0), schema)).toBeNull();
    expect(resolveSymbolAtPosition(document, pos(0, 8), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null on section header tokens without symbols", () => {
    const document = doc("frontend web extra");
    expect(resolveSymbolAtPosition(document, pos(0, 0), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition resolves proxy section names", () => {
    const document = doc("frontend web\n    bind :80");
    const col = "frontend web".indexOf("web");
    expect(resolveSymbolAtPosition(document, pos(0, col), schema)).toEqual({
      kind: "proxy-section",
      name: "web",
      scopeKey: null,
    });
  });

  it("buildSymbolIndex skips indented section headers", () => {
    const parsed = parseDocument(doc("    frontend web from profile_a"));
    const index = buildSymbolIndex(parsed, schema);
    expect(index.definitions.get("proxy-section:web")).toBeUndefined();
    expect(index.references.length).toBe(0);
  });

  it("buildSymbolIndex uses fixed slot name roles for definitions", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "filter",
        kind: "filter",
        definition_kind: "filter",
        fixed_slots: [{ role: "name" }],
      },
    ];
    const parsed = parseDocument(doc("backend api\n    filter compression"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.definitions.get("filter:backend:api:compression")?.length).toBe(1);
  });

  it("buildSymbolIndex skips definitions without name tokens", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "filter",
        kind: "filter",
        definition_kind: "filter",
        fixed_slots: [{ role: "name" }],
      },
    ];
    const parsed = parseDocument(doc("backend api\n    filter"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.definitions.get("filter:backend:api:undefined")).toBeUndefined();
    expect(index.definitions.size).toBe(1);
  });

  it("resolveSymbolAtPosition returns null for indented section headers", () => {
    const document = doc("    frontend web");
    expect(resolveSymbolAtPosition(document, pos(0, 10), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null for missing acl token", () => {
    const document = doc("frontend web\n    http-request deny if");
    expect(resolveSymbolAtPosition(document, pos(1, 30), schema)).toBeNull();
  });

  it("handles prefixed statement rules without keyword match", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "set-var",
        kind: "http-request",
        prefix: "http-request",
        definition_kind: "acl",
        value_token_index: 2,
      },
    ];
    const parsed = parseDocument(doc("frontend web\n    http-request deny"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.definitions.size).toBe(1);
  });

  it("resolveSymbolAtPosition returns null when no statement rules exist", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = undefined as never;
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const col = "    server s1".indexOf("s1");
    expect(resolveSymbolAtPosition(document, pos(1, col), customSchema)).toBeNull();
  });

  it("buildSymbolIndex handles undefined statement rules", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = undefined as never;
    const parsed = parseDocument(doc("frontend web\n    acl blocked path_beg /admin"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.references.length).toBeGreaterThanOrEqual(0);
  });

  it("resolveSymbolAtPosition keeps null scope in non-proxy sections", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "use_backend",
        kind: "directive",
        reference_kind: "proxy-section",
        value_token_index: 1,
      },
    ];
    const document = doc("global\n    use_backend api");
    const col = "    use_backend api".indexOf("api");
    expect(resolveSymbolAtPosition(document, pos(1, col), customSchema)).toEqual({
      kind: "proxy-section",
      name: "api",
      scopeKey: null,
    });
  });

  it("buildSymbolIndex skips references when statement rule token is missing", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "use_backend",
        kind: "directive",
        reference_kind: "proxy-section",
        value_token_index: 1,
      },
    ];
    const parsed = parseDocument(doc("frontend web\n    use_backend"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(index.references).toEqual([]);
  });

  it("resolveSymbolAtPosition ignores malformed section headers", () => {
    const document = doc("frontend web extra\n    bind :80");
    const col = "frontend web extra".indexOf("extra");
    expect(resolveSymbolAtPosition(document, pos(0, col), schema)).toBeNull();
  });

  it("tracks acl references introduced by unless and strips leading bang", () => {
    const parsed = parseDocument(
      doc("frontend web\n    acl blocked path_beg /admin\n    http-request deny unless !blocked"),
    );
    const index = buildSymbolIndex(parsed, schema);
    const refs = findReferences(index, "acl", "blocked", "frontend:web");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.name).toBe("blocked");
  });

  it("uses value token indexes for definitions and unscoped symbol keys", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "use_backend",
        kind: "directive",
        definition_kind: "proxy-section",
        value_token_index: 1,
      },
    ];
    const parsed = parseDocument(doc("frontend web\n    use_backend api"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(findDefinitions(index, "proxy-section", "api", "frontend:web")).toHaveLength(1);
    expect(symbolKey("proxy-section", "Api", "frontend:web")).toBe("proxy-section:api");
  });

  it("findAllSites returns both definitions and references", () => {
    const parsed = parseDocument(
      doc("defaults base\nfrontend web from base\nbackend api\n    use_backend api if TRUE"),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findAllSites(index, "defaults-profile", "base", null)).toHaveLength(2);
  });
});
