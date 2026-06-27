import * as vscode from "vscode";
import { describe, expect, it } from "vitest";

import { computeDiagnostics } from "../../src/diagnostics";
import { parseDocument } from "../../src/parser";
import {
  buildSymbolIndex,
  findReferences,
  symbolKey,
  type SymbolIndex,
  type SymbolKind,
} from "../../src/symbolIndex";
import { unusedSymbolDiagnostics } from "../../src/unusedSymbolDiagnostics";
import { createDocument } from "../helpers/document";
import { formatDiagnosticCode } from "../helpers/diagnosticFormat";
import { loadSchema } from "../helpers/schema";

const schema = loadSchema("3.4");

function unusedDiags(content: string, options: { sections?: boolean } = {}): vscode.Diagnostic[] {
  const document = createDocument(content);
  return computeDiagnostics(document, schema, {
    unusedSymbols: true,
    unusedSymbolSections: options.sections ?? true,
    maxLines: 4000,
  }).filter((diag) => formatDiagnosticCode(diag.code).startsWith("unused-"));
}

describe("unusedSymbolDiagnostics", () => {
  it("reports unused ACL when never referenced", () => {
    const diags = unusedDiags("frontend web\n    acl blocked path_beg /admin\n    bind :80");
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe("unused-acl");
    expect(diags[0]?.message).toContain("blocked");
    expect(diags[0]?.severity).toBe(vscode.DiagnosticSeverity.Hint);
    expect(diags[0]?.tags).toContain(vscode.DiagnosticTag.Unnecessary);
    expect(diags[0]?.range.start.line).toBe(1);
  });

  it("suppresses unused ACL when referenced in if conditions", () => {
    const diags = unusedDiags(
      "frontend web\n    acl blocked path_beg /admin\n    http-request deny if blocked",
    );
    expect(diags.filter((d) => d.code === "unused-acl")).toHaveLength(0);
  });

  it("suppresses unused ACL when referenced in inline blocks", () => {
    const diags = unusedDiags(
      "frontend web\n    acl blocked path_beg /admin\n    http-request deny if { blocked -m found }",
    );
    expect(diags.filter((d) => d.code === "unused-acl")).toHaveLength(0);
  });

  it("reports unused backend spanning the full section block", () => {
    const diags = unusedDiags(
      "frontend web\n    bind :80\nbackend old_api\n    server s1 127.0.0.1:80",
    );
    const sectionDiag = diags.find((d) => d.code === "unused-section");
    expect(sectionDiag).toBeDefined();
    expect(sectionDiag?.range.start.line).toBe(2);
    expect(sectionDiag?.range.end.line).toBe(3);
    expect(sectionDiag?.message).toContain("old_api");
  });

  it("suppresses unused backend when referenced by use_backend", () => {
    const diags = unusedDiags(
      "frontend web\n    bind :80\n    use_backend api\nbackend api\n    server s1 127.0.0.1:80",
    );
    expect(diags.filter((d) => d.code === "unused-section")).toHaveLength(0);
  });

  it("does not report frontend with bind as unused", () => {
    const diags = unusedDiags("frontend web\n    bind :80");
    expect(diags.filter((d) => d.code === "unused-section")).toHaveLength(0);
  });

  it("reports unused named defaults profile", () => {
    const diags = unusedDiags("defaults profile_a\n    timeout connect 5s");
    const profileDiag = diags.find((d) => d.code === "unused-defaults-profile");
    expect(profileDiag).toBeDefined();
    expect(profileDiag?.range.start.line).toBe(0);
    expect(profileDiag?.range.end.line).toBe(1);
  });

  it("suppresses unused defaults profile referenced by from", () => {
    const diags = unusedDiags("defaults profile_a\nfrontend web from profile_a\n    bind :80");
    expect(diags.filter((d) => d.code === "unused-defaults-profile")).toHaveLength(0);
  });

  it("reports one hint for duplicate ACL definitions", () => {
    const diags = unusedDiags(
      "frontend web\n    acl blocked path_beg /admin\n    acl blocked path_end /admin",
    );
    expect(diags.filter((d) => d.code === "unused-acl")).toHaveLength(1);
  });

  it("skips unused section hints when sections setting is disabled", () => {
    const diags = unusedDiags("backend old_api\n    server s1 127.0.0.1:80", {
      sections: false,
    });
    expect(diags.filter((d) => d.code === "unused-section")).toHaveLength(0);
  });

  it("returns no unused diagnostics when feature is disabled", () => {
    const document = createDocument("frontend web\n    acl blocked path_beg /admin\n    bind :80");
    const diags = computeDiagnostics(document, schema, { unusedSymbols: false });
    expect(diags.filter((d) => formatDiagnosticCode(d.code).startsWith("unused-"))).toHaveLength(0);
  });
});

describe("symbolIndex reference expansion", () => {
  it("tracks cache references from cache-use actions", () => {
    const content =
      "cache bench_cache\n    total-max-size 4\nfrontend web\n    http-request cache-use bench_cache";
    const parsed = parseDocument(createDocument(content));
    const index = buildSymbolIndex(parsed, schema);
    expect(parsed[3]?.tokens.map((token) => token.text)).toEqual([
      "http-request",
      "cache-use",
      "bench_cache",
    ]);
    expect(index.references.filter((ref) => ref.kind === "cache")).toHaveLength(1);
    expect(findReferences(index, "cache", "bench_cache", null)).toHaveLength(1);
  });

  it("tracks resolvers references on server lines", () => {
    const parsed = parseDocument(
      createDocument(
        "resolvers mydns\n    nameserver ns1 127.0.0.1:53\nbackend api\n    server s1 host:80 resolvers mydns",
      ),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findReferences(index, "resolvers", "mydns", null)).toHaveLength(1);
  });

  it("tracks userlist references in http_auth sample fetches", () => {
    const parsed = parseDocument(
      createDocument(
        "userlist stats-auth\n    user admin insecure-password admin\nfrontend web\n    acl AUTH http_auth(stats-auth)",
      ),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findReferences(index, "userlist", "stats-auth", null)).toHaveLength(1);
  });

  it("tracks peers references in stick-table lines", () => {
    const parsed = parseDocument(
      createDocument(
        "peers mypeers\n    peer p1 127.0.0.1:10000\nfrontend web\n    stick-table type ip size 1 peers mypeers",
      ),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findReferences(index, "peers", "mypeers", null)).toHaveLength(1);
  });

  it("tracks filter-sequence references", () => {
    const parsed = parseDocument(
      createDocument(
        "frontend web\n    filter comp-req\n    filter comp-res\n    filter-sequence request comp-req,comp-res",
      ),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findReferences(index, "filter", "comp-req", "frontend:web").length).toBeGreaterThan(0);
    expect(findReferences(index, "filter", "comp-res", "frontend:web").length).toBeGreaterThan(0);
  });

  it("reports unused cache, userlist, resolvers, and peers sections", () => {
    expect(
      unusedDiags("cache bench_cache\n    total-max-size 4\nfrontend web\n    bind :80").some(
        (d) => d.code === "unused-symbol" && d.message.includes("bench_cache"),
      ),
    ).toBe(true);
    expect(
      unusedDiags(
        "userlist stats\n    user u insecure-password p\nfrontend web\n    bind :80",
      ).some((d) => d.message.includes("stats")),
    ).toBe(true);
    expect(
      unusedDiags(
        "resolvers mydns\n    nameserver ns 127.0.0.1:53\nfrontend web\n    bind :80",
      ).some((d) => d.message.includes("mydns")),
    ).toBe(true);
    expect(
      unusedDiags("peers mypeers\n    peer p1 127.0.0.1:10000\nfrontend web\n    bind :80").some(
        (d) => d.message.includes("mypeers"),
      ),
    ).toBe(true);
  });

  it("unusedSymbolDiagnostics direct API respects enabled flag", () => {
    const document = createDocument("backend old_api\n    server s1 127.0.0.1:80");
    const parsed = parseDocument(document);
    const index = buildSymbolIndex(parsed, schema);
    expect(
      unusedSymbolDiagnostics(document, parsed, index, {
        enabled: false,
        includeSections: true,
      }),
    ).toHaveLength(0);
  });

  it("handles crafted index edge cases", () => {
    const document = createDocument("frontend web\n    bind :80");
    const parsed = parseDocument(document);

    const filterIndex: SymbolIndex = {
      definitions: new Map([
        [
          symbolKey("filter", "f1", "frontend:web"),
          [
            {
              kind: "filter",
              name: "f1",
              line: 1,
              start: 4,
              end: 10,
              scopeKey: "frontend:web",
              role: "definition",
            },
          ],
        ],
      ]),
      references: [],
      referencesByKey: new Map(),
      scopeKeyByLine: [],
    };
    expect(
      unusedSymbolDiagnostics(document, parsed, filterIndex, {
        enabled: true,
        includeSections: true,
      }),
    ).toHaveLength(0);

    const emptyDefsIndex: SymbolIndex = {
      definitions: new Map([[symbolKey("acl", "x", "frontend:web"), []]]),
      references: [],
      referencesByKey: new Map(),
      scopeKeyByLine: [],
    };
    expect(
      unusedSymbolDiagnostics(document, parsed, emptyDefsIndex, {
        enabled: true,
        includeSections: true,
      }),
    ).toHaveLength(0);

    const unknownKindIndex: SymbolIndex = {
      definitions: new Map([
        [
          "custom:widget",
          [
            {
              kind: "widget" as SymbolKind,
              name: "widget",
              line: 1,
              start: 4,
              end: 10,
              scopeKey: "frontend:web",
              role: "definition",
            },
          ],
        ],
      ]),
      references: [],
      referencesByKey: new Map(),
      scopeKeyByLine: [],
    };
    const unknownDiag = unusedSymbolDiagnostics(document, parsed, unknownKindIndex, {
      enabled: true,
      includeSections: true,
    });
    expect(unknownDiag).toHaveLength(1);
    expect(unknownDiag[0]?.message).toContain("appears unused");

    const orphanSectionIndex: SymbolIndex = {
      definitions: new Map([
        [
          symbolKey("cache", "orphan", null),
          [
            {
              kind: "cache",
              name: "orphan",
              line: 99,
              start: 0,
              end: 6,
              scopeKey: null,
              role: "definition",
            },
          ],
        ],
      ]),
      references: [],
      referencesByKey: new Map(),
      scopeKeyByLine: [],
    };
    const orphanDiag = unusedSymbolDiagnostics(document, parsed, orphanSectionIndex, {
      enabled: true,
      includeSections: true,
    });
    expect(orphanDiag).toHaveLength(1);
    expect(orphanDiag[0]?.range.start.line).toBe(99);

    const misfiledFrontendIndex: SymbolIndex = {
      definitions: new Map([
        [
          symbolKey("proxy-section", "wide", null),
          [
            {
              kind: "proxy-section",
              name: "wide",
              line: 1,
              start: 4,
              end: 8,
              scopeKey: "frontend:wide",
              role: "definition",
            },
          ],
        ],
      ]),
      references: [],
      referencesByKey: new Map(),
      scopeKeyByLine: [],
    };
    const misfiledDiag = unusedSymbolDiagnostics(
      createDocument("frontend wide\n    mode http"),
      parseDocument(createDocument("frontend wide\n    mode http")),
      misfiledFrontendIndex,
      { enabled: true, includeSections: true },
    );
    expect(misfiledDiag).toHaveLength(1);
    expect(misfiledDiag[0]?.message).toContain("Section 'wide'");
  });
});
