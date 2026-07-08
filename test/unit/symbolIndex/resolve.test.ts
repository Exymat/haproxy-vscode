import { resolveSymbolAtPosition } from "../../../src/symbolIndex";

import { doc, pos, schema } from "./helpers";

describe("symbolIndex resolve", () => {
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

  it("resolveSymbolAtPosition resolves environment variables in definitions and references", () => {
    const document = doc(
      [
        "global",
        "    setenv FOO bar",
        '    log "${FOO-default}:514" local0',
        '    user "$FOO"',
        "    http-request deny if { env(FOO) -m found }",
      ].join("\n"),
    );

    for (const [line, needle] of [
      [1, "FOO bar"],
      [2, "FOO-default"],
      [3, "FOO"],
      [4, "FOO)"],
    ] as const) {
      const col = document.lineAt(line).text.indexOf(needle);
      expect(resolveSymbolAtPosition(document, pos(line, col), schema)).toEqual({
        kind: "environment-variable",
        name: "FOO",
        scopeKey: null,
      });
    }
  });

  it("resolveSymbolAtPosition uses caller-provided scope arrays", () => {
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const serverCol = "    server s1".indexOf("s1");
    expect(
      resolveSymbolAtPosition(document, pos(1, serverCol), schema, [null, "backend:other"]),
    ).toEqual({
      kind: "server",
      name: "s1",
      scopeKey: "backend:other",
    });
    expect(resolveSymbolAtPosition(document, pos(1, serverCol), schema, [null])).toEqual({
      kind: "server",
      name: "s1",
      scopeKey: null,
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

  it("resolveSymbolAtPosition ignores the section-header from keyword itself", () => {
    const document = doc("defaults profile_a\nfrontend web from profile_a");
    const fromCol = "frontend web from profile_a".indexOf("from");
    expect(resolveSymbolAtPosition(document, pos(1, fromCol), schema)).toBeNull();
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

  it("resolveSymbolAtPosition returns null for indented section headers", () => {
    const document = doc("    frontend web");
    expect(resolveSymbolAtPosition(document, pos(0, 10), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null for missing acl token", () => {
    const document = doc("frontend web\n    http-request deny if");
    expect(resolveSymbolAtPosition(document, pos(1, 30), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition returns null when no statement rules exist", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = undefined as never;
    const document = doc("backend api\n    server s1 127.0.0.1:80");
    const col = "    server s1".indexOf("s1");
    expect(resolveSymbolAtPosition(document, pos(1, col), customSchema)).toBeNull();
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

  it("resolveSymbolAtPosition ignores reference rules when the cursor is not on the target", () => {
    const document = doc("frontend web\n    use_backend api");
    const directiveCol = "    use_backend api".indexOf("use_backend");
    expect(resolveSymbolAtPosition(document, pos(1, directiveCol), schema)).toBeNull();
  });

  it("resolveSymbolAtPosition ignores malformed section headers", () => {
    const document = doc("frontend web extra\n    bind :80");
    const col = "frontend web extra".indexOf("extra");
    expect(resolveSymbolAtPosition(document, pos(0, col), schema)).toBeNull();
  });

  it("resolves configured reference-pattern symbols at the cursor", () => {
    const document = doc("backend api\n    default-server resolvers dns-main");
    const col = "    default-server resolvers dns-main".indexOf("dns-main");
    expect(resolveSymbolAtPosition(document, pos(1, col), schema)).toEqual({
      kind: "resolvers",
      name: "dns-main",
      scopeKey: null,
    });
  });

  it("resolves configured section-scoped reference-pattern symbols at the cursor", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [];
    customSchema.reference_patterns = [
      {
        match_tokens: ["set-filter"],
        reference_kind: "filter",
        target_token_index: 1,
        scope: "section",
      },
    ];
    const document = doc("backend api\n    set-filter compression");
    const col = "    set-filter compression".indexOf("compression");
    expect(resolveSymbolAtPosition(document, pos(1, col), customSchema)).toEqual({
      kind: "filter",
      name: "compression",
      scopeKey: "backend:api",
    });
  });
});
