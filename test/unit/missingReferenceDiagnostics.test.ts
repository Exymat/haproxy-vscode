import * as vscode from "vscode";

import { computeDiagnostics } from "../../src/diagnostics";
import { missingReferenceDiagnostics } from "../../src/missingReferenceDiagnostics";
import { SymbolIndex } from "../../src/symbolIndex";
import { buildSitesByLine } from "../../src/symbolIndex/utils";
import { createDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";

const schema = loadSchema("3.4");

function missingRefs(content: string, enabled = true): vscode.Diagnostic[] {
  return computeDiagnostics(createDocument(content), schema, {
    unusedSymbols: false,
    missingReferences: enabled,
    maxLines: 4000,
  }).filter((diag) => diag.code === "missing-reference");
}

describe("missingReferenceDiagnostics", () => {
  it("reports missing use_backend and default_backend targets", () => {
    const diags = missingRefs("frontend web\n    use_backend api\n    default_backend fallback");
    expect(diags).toHaveLength(2);
    expect(diags.map((d) => d.range.start.line)).toEqual([1, 2]);
    expect(diags.every((d) => d.severity === vscode.DiagnosticSeverity.Warning)).toBe(true);
  });

  it("reports missing ACL references in conditions", () => {
    const content = [
      "frontend web",
      "    http-request deny if missing",
      "    http-request deny unless !blocked",
      "    http-request deny if { inline_missing -m found }",
      "    http-request deny if first_missing || second_missing",
    ].join("\n");
    const diags = missingRefs(content);
    expect(diags.map((d) => d.range.start.line)).toEqual([1, 2, 3, 4, 4]);
    expect(diags[1]?.range.start.character).toBe(
      "    http-request deny unless !blocked".indexOf("blocked"),
    );
  });

  it("does not use definitions from another proxy scope", () => {
    const content = [
      "frontend one",
      "    acl only_one path /one",
      "frontend two",
      "    http-request deny if only_one",
    ].join("\n");
    const diags = missingRefs(content);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain("Acl 'only_one'");
  });

  it("reports missing defaults, server, cache, resolvers, peers, userlist, and filter references", () => {
    const content = [
      "frontend web from base",
      "    use-server s1",
      "    http-request cache-use missing_cache",
      "    acl AUTH http_auth(stats-auth)",
      "backend api",
      "    server s1 host.local:80 resolvers dns-main",
      "    stick-table type ip size 1 peers cluster",
      "    filter-sequence request comp-req,comp-res",
    ].join("\n");
    const diags = missingRefs(content);
    expect(diags.map((d) => d.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Defaults profile 'base'"),
        expect.stringContaining("Server 's1'"),
        expect.stringContaining("cache section 'missing_cache'"),
        expect.stringContaining("Userlist 'stats-auth'"),
        expect.stringContaining("resolvers section 'dns-main'"),
        expect.stringContaining("peers section 'cluster'"),
        expect.stringContaining("Filter 'comp-req'"),
        expect.stringContaining("Filter 'comp-res'"),
      ]),
    );
    const authDiag = diags.find((d) => d.message.includes("stats-auth"));
    expect(authDiag?.range.start.character).toBe("    acl AUTH http_auth(".length);
  });

  it("does not treat inline sample fetches or dynamic backends as missing references", () => {
    const content = [
      "frontend web",
      '    use_backend www if { var(http_host) -m reg -p "^www\\." }',
      '    use_backend non_www if { var(http_host) -m reg -p "^(?!www\\.).*" }',
      "    use_backend dynamic if { path_beg /dynamic }",
      "    use_backend %[var(http_host)] if { var(http_host) }",
      "backend www",
      "backend non_www",
      "backend dynamic",
    ].join("\n");
    expect(missingRefs(content)).toEqual([]);
  });

  it("does not report missing environment variables", () => {
    const content = [
      "global",
      '    user "$HAPROXY_USER"',
      "    http-request deny if { env(EXTERNAL_FLAG) -m found }",
      "    unsetenv SECRET_TOKEN",
    ].join("\n");
    expect(missingRefs(content)).toEqual([]);
  });

  it("does not report references that have matching definitions", () => {
    const content = [
      "defaults base",
      "frontend web from base",
      "    acl ok path /",
      "    http-request deny if ok",
      "backend api",
      "    server s1 127.0.0.1:80",
      "    use-server s1",
      "cache c1",
      "    total-max-size 4",
      "frontend web2",
      "    http-request cache-use c1",
    ].join("\n");
    expect(missingRefs(content)).toEqual([]);
  });

  it("can be disabled independently of unused-symbol diagnostics", () => {
    const content = "frontend web\n    use_backend missing";
    expect(missingRefs(content, true)).toHaveLength(1);
    expect(missingRefs(content, false)).toHaveLength(0);
  });

  it("uses file-scoped message by default", () => {
    const ref = {
      kind: "proxy-section" as const,
      name: "missing",
      line: 0,
      start: 12,
      end: 19,
      scopeKey: null,
      role: "reference" as const,
    };
    const index: SymbolIndex = {
      definitions: new Map(),
      references: [ref],
      referencesByKey: new Map(),
      scopeKeyByLine: [null],
      scopedSymbolKinds: new Set(["acl", "server", "filter"]),
      sitesByLine: buildSitesByLine(1, new Map(), [ref]),
      unresolvedReferences: [ref],
    };
    expect(missingReferenceDiagnostics(index, schema)[0]?.message).toContain(
      "not defined in this file",
    );
  });

  it("uses workspace-scoped message when scope is workspace", () => {
    const ref = {
      kind: "proxy-section" as const,
      name: "missing",
      line: 0,
      start: 12,
      end: 19,
      scopeKey: null,
      role: "reference" as const,
    };
    const index: SymbolIndex = {
      definitions: new Map(),
      references: [ref],
      referencesByKey: new Map(),
      scopeKeyByLine: [null],
      scopedSymbolKinds: new Set(["acl", "server", "filter"]),
      sitesByLine: buildSitesByLine(1, new Map(), [ref]),
      unresolvedReferences: [ref],
    };
    expect(
      missingReferenceDiagnostics(index, schema, { scope: "workspace" })[0]?.message,
    ).toContain("not defined in this workspace");
  });

  it("deduplicates identical reference sites defensively", () => {
    const ref = {
      kind: "proxy-section",
      name: "missing",
      line: 0,
      start: 12,
      end: 19,
      scopeKey: null,
      role: "reference",
    } as const;
    const index: SymbolIndex = {
      definitions: new Map(),
      references: [ref, ref],
      referencesByKey: new Map(),
      scopeKeyByLine: [null],
      scopedSymbolKinds: new Set(["acl", "server", "filter"]),
      sitesByLine: buildSitesByLine(1, new Map(), [ref, ref]),
      unresolvedReferences: [ref],
    };
    expect(missingReferenceDiagnostics(index, schema)).toHaveLength(1);
  });

  it("skips unresolved environment variable references defensively", () => {
    const ref = {
      kind: "environment-variable",
      name: "EXTERNAL",
      line: 0,
      start: 1,
      end: 9,
      scopeKey: null,
      role: "reference",
    } as const;
    const index: SymbolIndex = {
      definitions: new Map(),
      references: [ref],
      referencesByKey: new Map(),
      scopeKeyByLine: [null],
      scopedSymbolKinds: new Set(["acl", "server", "filter"]),
      sitesByLine: buildSitesByLine(1, new Map(), [ref]),
      unresolvedReferences: [ref],
    };
    expect(missingReferenceDiagnostics(index, schema)).toEqual([]);
  });
});
