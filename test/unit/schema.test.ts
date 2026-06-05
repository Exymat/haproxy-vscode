import {
  buildPrefixSubcommands,
  clearSchemaCache,
  conditionalTokenSet,
  loadSchema,
  modifierPrefixSet,
  namedDefaultsKeywordSet,
  noPrefixKeywordSet,
  optionsWithValueSet,
  sectionKeywordSet,
  sectionNames,
  statsSocketLevelSet,
  tcpRulePhaseSet,
} from "../../src/schema";
import { resetVscodeMock } from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";
import { loadSchema as loadFixtureSchema } from "../helpers/schema";

describe("loadSchema", () => {
  beforeEach(() => {
    resetVscodeMock();
    clearSchemaCache();
  });

  it("loads and caches schema by version", () => {
    const context = mockExtensionContext();
    const first = loadSchema(context as never, "3.2");
    const second = loadSchema(context as never, "3.2");
    expect(first).toBe(second);
    expect(first.version).toBe("3.2");
  });

  it("returns fresh schema after cache clear", () => {
    const context = mockExtensionContext();
    const before = loadSchema(context as never, "3.4");
    clearSchemaCache();
    const after = loadSchema(context as never, "3.4");
    expect(after).not.toBe(before);
  });
});

describe("schema helpers", () => {
  const schema = loadFixtureSchema("3.4");

  it("buildPrefixSubcommands collects subcommands after prefix", () => {
    const subs = buildPrefixSubcommands(
      ["tcp-request connection accept", "tcp-request content accept", "http-request deny"],
      "tcp-request",
    );
    expect(subs.has("connection accept")).toBe(true);
    expect(subs.has("content accept")).toBe(true);
    expect(subs.has("deny")).toBe(false);
  });

  it("exposes token sets from schema", () => {
    expect(noPrefixKeywordSet(schema).has("log")).toBe(true);
    expect(modifierPrefixSet(schema).size).toBeGreaterThan(0);
    expect(conditionalTokenSet(schema).has("if")).toBe(true);
    expect(namedDefaultsKeywordSet(schema).has("acl")).toBe(true);
  });

  it("collects tcp rule phases from keywords", () => {
    const phases = tcpRulePhaseSet(schema);
    expect(phases.has("connection")).toBe(true);
    expect(phases.has("content")).toBe(true);
  });

  it("caches optionsWithValueSet per group", () => {
    const first = optionsWithValueSet(schema, "bind_options");
    const second = optionsWithValueSet(schema, "bind_options");
    expect(first).toBe(second);
    expect(first.size).toBeGreaterThan(0);
  });

  it("returns empty sectionKeywordSet for null section", () => {
    expect(sectionKeywordSet(schema, null).size).toBe(0);
  });

  it("caches sectionKeywordSet per section", () => {
    const first = sectionKeywordSet(schema, "frontend");
    const second = sectionKeywordSet(schema, "frontend");
    expect(first).toBe(second);
    expect(first.has("bind")).toBe(true);
    expect(first.has("acl")).toBe(true);
  });

  it("lists section names sorted", () => {
    const names = sectionNames(schema);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("frontend");
    expect(names).toContain("backend");
  });

  it("exposes stats socket levels", () => {
    expect(statsSocketLevelSet()).toEqual(new Set(["user", "operator", "admin"]));
  });
});
