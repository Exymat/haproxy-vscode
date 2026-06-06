import { parseDocument } from "../../src/parser";
import { buildSymbolIndex, getSymbolIndex, resolveSymbolAtPosition } from "../../src/symbolIndex";
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
});
