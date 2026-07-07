import * as assert from "node:assert";
import * as vscode from "vscode";

import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import {
  assertDiagnosticCounts,
  clearHaproxySetting,
  completionLabelsAt,
  completionItemsAt,
  definitionLocationsAt,
  ensureHaproxyVersion,
  fixturePath,
  filterDiagnostics,
  formatDocumentContent,
  hoverTextAt,
  openFixture,
  openHaproxyDocument,
  openTempFixtureDocument,
  positionOf,
  referenceLocationsAt,
  renameEditsAt,
  replaceDocumentContent,
  resetHaproxySettings,
  updateHaproxySetting,
  waitForSchemaDiagnostics,
} from "./helpers";

const NAVIGATION_CONFIG = [
  "defaults profile_default",
  "    mode http",
  "frontend web from profile_default",
  "    bind :80",
  "    acl is_api path_beg /api",
  "    use_backend api if is_api",
  "backend api",
  "    server web1 127.0.0.1:8080 check",
  "    use-server web1 if is_api",
].join("\n");

async function waitForDefinitionTarget(
  uri: vscode.Uri,
  position: vscode.Position,
  expectedUriSuffix: string,
): Promise<vscode.Location[]> {
  const deadline = Date.now() + 10000;
  let locations: vscode.Location[] = [];
  while (Date.now() < deadline) {
    locations = await definitionLocationsAt(uri, position);
    if (locations.some((location) => location.uri.toString().endsWith(expectedUriSuffix))) {
      return locations;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return locations;
}

async function waitForReferenceUris(
  uri: vscode.Uri,
  position: vscode.Position,
  expectedUriSuffixes: string[],
): Promise<vscode.Location[]> {
  const deadline = Date.now() + 10000;
  let locations: vscode.Location[] = [];
  while (Date.now() < deadline) {
    locations = await referenceLocationsAt(uri, position, true);
    const actual = new Set(locations.map((location) => location.uri.toString()));
    if (
      expectedUriSuffixes.every((suffix) =>
        [...actual].some((actualUri) => actualUri.endsWith(suffix)),
      )
    ) {
      return locations;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return locations;
}

function pathSuffix(uri: vscode.Uri): string {
  const path = uri.path.replace(/\\/g, "/");
  const marker = "/workspace-symbols/";
  const markerIndex = path.indexOf(marker);
  return markerIndex >= 0 ? path.slice(markerIndex) : path;
}

async function waitForNoDiagnosticCode(
  uri: vscode.Uri,
  code: string,
): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + 10000;
  let diagnostics: vscode.Diagnostic[] = [];
  while (Date.now() < deadline) {
    diagnostics = await waitForSchemaDiagnostics(uri, 0, 2000);
    if (!diagnostics.some((diag) => formatDiagnosticCode(diag.code) === code)) {
      return diagnostics;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return diagnostics;
}

async function waitForDiagnosticCode(uri: vscode.Uri, code: string): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + 10000;
  let diagnostics: vscode.Diagnostic[] = [];
  while (Date.now() < deadline) {
    diagnostics = await waitForSchemaDiagnostics(uri, 0, 2000);
    if (diagnostics.some((diag) => formatDiagnosticCode(diag.code) === code)) {
      return diagnostics;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return diagnostics;
}

suite("Language feature integration", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await resetHaproxySettings();
  });

  suite("Navigation providers", () => {
    suiteSetup(async () => {
      await updateHaproxySetting("workspaceSymbols.enabled", false);
    });

    suiteTeardown(async () => {
      await resetHaproxySettings();
      await ensureHaproxyVersion("3.2");
    });

    test("file-backed fixture resolves backend, server, defaults, and ACL targets", async () => {
      const doc = await openFixture("symbol-graph.cfg");

      const backendDefs = await definitionLocationsAt(doc.uri, positionOf(doc, "api if is_api"));
      assert.strictEqual(backendDefs.length, 1, "Expected one backend definition");
      assert.strictEqual(
        backendDefs[0]?.range.start.line,
        positionOf(doc, "backend api\n    server").line,
      );

      const serverDefs = await definitionLocationsAt(doc.uri, positionOf(doc, "web1 if is_api"));
      assert.strictEqual(serverDefs.length, 1, "Expected one server definition");
      assert.strictEqual(serverDefs[0]?.range.start.line, positionOf(doc, "server web1").line);

      const defaultsDefs = await definitionLocationsAt(
        doc.uri,
        positionOf(doc, "profile_default", 1),
      );
      assert.strictEqual(defaultsDefs.length, 1, "Expected one defaults profile definition");
      assert.strictEqual(
        defaultsDefs[0]?.range.start.line,
        positionOf(doc, "defaults profile_default").line,
      );

      const aclRefs = await referenceLocationsAt(doc.uri, positionOf(doc, "is_api", 1), true);
      assert.deepStrictEqual(
        aclRefs.map((location) => location.range.start.line).sort((a, b) => a - b),
        [positionOf(doc, "acl is_api").line, positionOf(doc, "api if is_api").line],
      );
    });

    test("file-backed fixture resolves cache, resolvers, userlist, peers, and filters", async () => {
      const doc = await openFixture("symbol-graph.cfg");

      for (const [label, needle, expectedNeedles] of [
        ["cache", "bench_cache", ["cache bench_cache", "cache-use bench_cache"]],
        ["resolvers", "mydns", ["resolvers mydns", "resolvers mydns check"]],
        ["userlist", "stats-auth", ["userlist stats-auth", "http_auth(stats-auth)"]],
        ["peers", "mypeers", ["peers mypeers", "peers mypeers"]],
        ["filter", "comp-res", ["filter comp-res", "comp-req,comp-res"]],
      ] as const) {
        const references = await referenceLocationsAt(doc.uri, positionOf(doc, needle), true);
        const actualLines = references
          .map((location) => location.range.start.line)
          .sort((a, b) => a - b);
        const expectedLines = expectedNeedles
          .map((expectedNeedle, occurrence) =>
            label === "peers"
              ? positionOf(doc, expectedNeedle, occurrence).line
              : positionOf(doc, expectedNeedle).line,
          )
          .sort((a, b) => a - b);
        assert.deepStrictEqual(actualLines, expectedLines, `Unexpected ${label} references`);
      }
    });

    test("file-backed fixture renames one split filter-sequence reference", async () => {
      const doc = await openFixture("symbol-graph.cfg");
      const edit = await renameEditsAt(doc.uri, positionOf(doc, "comp-res", 1), "comp-alt");
      assert.ok(edit, "Expected filter rename edit");
      const applied = await vscode.workspace.applyEdit(edit);
      assert.strictEqual(applied, true, "Expected filter rename edit to apply");
      assert.ok(doc.getText().includes("filter comp-alt"));
      assert.ok(doc.getText().includes("filter-sequence request comp-req,comp-alt"));
      assert.ok(doc.getText().includes("filter comp-req"));
    });

    suite("Workspace symbol graph", () => {
      suiteSetup(async () => {
        await updateHaproxySetting("workspaceSymbols.enabled", true);
        await updateHaproxySetting("workspaceSymbols.include", ["**/workspace-symbols/**/*.cfg"]);
        await updateHaproxySetting("workspaceSymbols.exclude", []);
        await updateHaproxySetting("workspaceSymbols.maxFiles", 20);
        await updateHaproxySetting("workspaceSymbols.maxTotalLines", 1000);
        await updateHaproxySetting("workspaceSymbols.debounceMs", 100);
        await updateHaproxySetting("diagnostics.missingReferences", true);
        await updateHaproxySetting("diagnostics.unusedSymbols", true);
      });

      suiteTeardown(async () => {
        await updateHaproxySetting("workspaceSymbols.enabled", false);
      });

      test("go to definition crosses files for backend, cache, and resolvers", async () => {
        const frontend = await openFixture("workspace-symbols/frontends/web.cfg");
        const backendTarget = await waitForDefinitionTarget(
          frontend.uri,
          positionOf(frontend, "api"),
          "/workspace-symbols/backends/api.cfg",
        );
        assert.strictEqual(backendTarget.length, 1, "Expected one cross-file backend definition");
        assert.ok(
          backendTarget[0]?.uri.toString().endsWith("/workspace-symbols/backends/api.cfg"),
          `Expected backend definition in api.cfg, got ${backendTarget[0]?.uri.toString()}`,
        );
        assert.strictEqual(backendTarget[0]?.range.start.line, 0);

        const cacheTarget = await waitForDefinitionTarget(
          frontend.uri,
          positionOf(frontend, "shared_cache"),
          "/workspace-symbols/shared/cache.cfg",
        );
        assert.strictEqual(cacheTarget.length, 1, "Expected one cross-file cache definition");
        assert.ok(cacheTarget[0]?.uri.toString().endsWith("/workspace-symbols/shared/cache.cfg"));

        const backend = await vscode.workspace.openTextDocument(
          vscode.Uri.file(fixturePath("workspace-symbols/backends/api.cfg")),
        );
        const resolverTarget = await waitForDefinitionTarget(
          backend.uri,
          positionOf(backend, "dns-main"),
          "/workspace-symbols/shared/dns.cfg",
        );
        assert.strictEqual(resolverTarget.length, 1, "Expected one cross-file resolver definition");
        assert.ok(resolverTarget[0]?.uri.toString().endsWith("/workspace-symbols/shared/dns.cfg"));
      });

      test("find references returns declaration and usage across files", async () => {
        const backend = await openFixture("workspace-symbols/backends/api.cfg");
        const references = await waitForReferenceUris(backend.uri, positionOf(backend, "api"), [
          "/workspace-symbols/backends/api.cfg",
          "/workspace-symbols/frontends/web.cfg",
        ]);

        assert.deepStrictEqual(
          references.map((location) => pathSuffix(location.uri)).sort(),
          ["/workspace-symbols/backends/api.cfg", "/workspace-symbols/frontends/web.cfg"].sort(),
        );
      });

      test("diagnostics use workspace definitions and references", async () => {
        const frontend = await openFixture("workspace-symbols/frontends/web.cfg");
        const frontendDiagnostics = await waitForNoDiagnosticCode(
          frontend.uri,
          "missing-reference",
        );
        assert.strictEqual(
          frontendDiagnostics.filter(
            (diag) => formatDiagnosticCode(diag.code) === "missing-reference",
          ).length,
          0,
          `Expected no missing references in frontend, got ${frontendDiagnostics
            .map((diag) => diag.message)
            .join(", ")}`,
        );

        const backend = await openFixture("workspace-symbols/backends/api.cfg");
        const backendDiagnostics = await waitForNoDiagnosticCode(backend.uri, "unused-section");
        assert.strictEqual(
          backendDiagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "unused-section")
            .length,
          0,
          `Expected backend reference from frontend to suppress unused-section, got ${backendDiagnostics
            .map((diag) => diag.message)
            .join(", ")}`,
        );
      });

      test("diagnostics report duplicate sections across workspace files", async () => {
        const first = await openFixture("workspace-symbols/backends/duplicate-a.cfg");
        const firstDiagnostics = await waitForDiagnosticCode(first.uri, "duplicate-section");
        assert.strictEqual(
          firstDiagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "duplicate-section")
            .length,
          1,
          `Expected duplicate-section in first duplicate backend, got ${firstDiagnostics
            .map((diag) => `[${formatDiagnosticCode(diag.code)}] ${diag.message}`)
            .join(", ")}`,
        );

        const second = await openFixture("workspace-symbols/backends/duplicate-b.cfg");
        const secondDiagnostics = await waitForDiagnosticCode(second.uri, "duplicate-section");
        assert.strictEqual(
          secondDiagnostics.filter(
            (diag) => formatDiagnosticCode(diag.code) === "duplicate-section",
          ).length,
          1,
          `Expected duplicate-section in second duplicate backend, got ${secondDiagnostics
            .map((diag) => `[${formatDiagnosticCode(diag.code)}] ${diag.message}`)
            .join(", ")}`,
        );
      });
    });

    test("go to definition resolves backend, server, and defaults profile targets", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);

      const backendDefs = await definitionLocationsAt(
        doc.uri,
        new vscode.Position(5, "    use_backend ".length),
      );
      assert.strictEqual(backendDefs.length, 1, "Expected one backend definition");
      assert.strictEqual(backendDefs[0]?.range.start.line, 6);

      const serverDefs = await definitionLocationsAt(
        doc.uri,
        new vscode.Position(8, "    use-server ".length),
      );
      assert.strictEqual(serverDefs.length, 1, "Expected one server definition");
      assert.strictEqual(serverDefs[0]?.range.start.line, 7);

      const defaultsDefs = await definitionLocationsAt(
        doc.uri,
        new vscode.Position(2, "frontend web from ".length),
      );
      assert.strictEqual(defaultsDefs.length, 1, "Expected one defaults profile definition");
      assert.strictEqual(defaultsDefs[0]?.range.start.line, 0);
    });

    test("editor Go to Definition command navigates from backend reference", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
      const editor = await vscode.window.showTextDocument(doc);
      const refPosition = new vscode.Position(5, "    use_backend ".length + 1);
      editor.selection = new vscode.Selection(refPosition, refPosition);

      await vscode.commands.executeCommand("editor.action.revealDefinition");
      await new Promise((resolve) => setTimeout(resolve, 300));

      const active = vscode.window.activeTextEditor;
      assert.ok(active, "Expected an active editor after Go to Definition");
      assert.strictEqual(active.document.uri.toString(), doc.uri.toString());
      assert.strictEqual(active.selection.active.line, 6);
      assert.strictEqual(active.selection.active.character, "backend ".length);
    });

    test("find references returns ACL definition and frontend condition usage", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
      const pos = new vscode.Position(5, "    use_backend api if ".length);

      const references = await referenceLocationsAt(doc.uri, pos, true);
      assert.strictEqual(references.length, 2, "Expected ACL definition plus one condition usage");
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [4, 5],
      );
    });

    test("environment variable navigation resolves definitions and references", async () => {
      const doc = await openHaproxyDocument(
        [
          "global",
          "    setenv FOO bar",
          '    log "${FOO-default}:514" local0',
          "    http-request deny if { env(FOO) -m found }",
          '    user "$HAPROXY_USER"',
        ].join("\n"),
      );

      const defs = await definitionLocationsAt(
        doc.uri,
        new vscode.Position(2, '    log "${'.length),
      );
      assert.strictEqual(defs.length, 1, "Expected one environment variable definition");
      assert.strictEqual(defs[0]?.range.start.line, 1);
      assert.strictEqual(defs[0]?.range.start.character, "    setenv ".length);

      const references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(1, "    setenv ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [1, 2, 3],
      );

      const externalDefs = await definitionLocationsAt(
        doc.uri,
        new vscode.Position(4, '    user "$'.length),
      );
      assert.strictEqual(externalDefs.length, 0, "Expected no synthetic definition for externals");
    });

    test("find references resolves backend, server, and defaults profile sites", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);

      let references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(5, "    use_backend ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [5, 6],
      );

      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(8, "    use-server ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [7, 8],
      );

      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(2, "frontend web from ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 2],
      );
    });

    test("find references resolves cache, resolvers, userlist, and peers symbols", async () => {
      let doc = await openHaproxyDocument(
        "cache bench_cache\n    total-max-size 4\nfrontend web\n    http-request cache-use bench_cache\n",
      );
      let references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(0, "cache ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 3],
      );

      doc = await openHaproxyDocument(
        "resolvers mydns\n    nameserver ns1 127.0.0.1:53\nbackend api\n    server s1 host:80 resolvers mydns\n",
      );
      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(0, "resolvers ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 3],
      );

      doc = await openHaproxyDocument(
        "userlist stats-auth\n    user admin insecure-password admin\nfrontend web\n    acl AUTH http_auth(stats-auth)\n",
      );
      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(0, "userlist ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 3],
      );

      doc = await openHaproxyDocument(
        "peers mypeers\n    peer p1 127.0.0.1:10000\nfrontend web\n    stick-table type ip size 1 peers mypeers\n",
      );
      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(0, "peers ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 3],
      );
    });

    test("rename provider edits backend, ACL, defaults, and server references", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);

      let edit = await renameEditsAt(
        doc.uri,
        new vscode.Position(5, "    use_backend ".length),
        "api_v2",
      );
      assert.ok(edit, "Expected backend rename edit");
      let applied = await vscode.workspace.applyEdit(edit);
      assert.strictEqual(applied, true, "Expected backend rename edit to apply");
      assert.ok(doc.getText().includes("backend api_v2"));
      assert.ok(doc.getText().includes("use_backend api_v2"));

      edit = await renameEditsAt(
        doc.uri,
        new vscode.Position(5, "    use_backend api_v2 if ".length),
        "is_v2",
      );
      assert.ok(edit, "Expected ACL rename edit");
      applied = await vscode.workspace.applyEdit(edit);
      assert.strictEqual(applied, true, "Expected ACL rename edit to apply");
      assert.ok(doc.getText().includes("acl is_v2"));
      assert.ok(doc.getText().includes("if is_v2"));

      edit = await renameEditsAt(
        doc.uri,
        new vscode.Position(2, "frontend web from ".length),
        "base_v2",
      );
      assert.ok(edit, "Expected defaults rename edit");
      applied = await vscode.workspace.applyEdit(edit);
      assert.strictEqual(applied, true, "Expected defaults rename edit to apply");
      assert.ok(doc.getText().includes("defaults base_v2"));
      assert.ok(doc.getText().includes("from base_v2"));

      edit = await renameEditsAt(doc.uri, new vscode.Position(8, "    use-server ".length), "web2");
      assert.ok(edit, "Expected server rename edit");
      applied = await vscode.workspace.applyEdit(edit);
      assert.strictEqual(applied, true, "Expected server rename edit to apply");
      assert.ok(doc.getText().includes("server web2"));
      assert.ok(doc.getText().includes("use-server web2"));
    });
  });

  suite("Outline and folding", () => {
    test("document symbols expose top-level section outline", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
      const symbols = await vscode.commands.executeCommand<
        Array<vscode.DocumentSymbol | vscode.SymbolInformation>
      >("vscode.executeDocumentSymbolProvider", doc.uri);

      assert.ok(symbols && symbols.length >= 3, "Expected section symbols");
      const names = symbols.map((symbol) => symbol.name);
      assert.deepStrictEqual(names.slice(0, 3), [
        "defaults profile_default",
        "frontend web from profile_default",
        "backend api",
      ]);
    });

    test("folding ranges cover section bodies", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
      const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
        "vscode.executeFoldingRangeProvider",
        doc.uri,
      );

      assert.ok(ranges && ranges.length >= 3, "Expected folding ranges");
      assert.ok(
        ranges.some((range) => range.start === 0 && range.end === 1),
        "Expected defaults folding range",
      );
      assert.ok(
        ranges.some((range) => range.start === 2 && range.end === 5),
        "Expected frontend folding range",
      );
      assert.ok(
        ranges.some((range) => range.start === 6 && range.end === 8),
        "Expected backend folding range",
      );
    });
  });

  suite("Diagnostics lifecycle", () => {
    suiteTeardown(async () => {
      await updateHaproxySetting("diagnostics.enabled", true);
      await clearHaproxySetting("diagnostics.unusedSymbols.sections");
      await updateHaproxySetting("diagnostics.unusedSymbols", true);
    });

    test("diagnostics refresh after document edits", async () => {
      let doc = await openHaproxyDocument("frontend web\n    mode ftp\n");
      let diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assertDiagnosticCounts(diagnostics, { "unknown-value": 1 }, "invalid mode before edit");

      doc = await replaceDocumentContent(doc, "frontend web\n    mode http\n");
      diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
      const errors = filterDiagnostics(diagnostics, vscode.DiagnosticSeverity.Error);
      assert.strictEqual(
        errors.length,
        0,
        `Expected diagnostics to clear after edit, got: ${errors.map((d) => d.message).join(", ")}`,
      );
    });

    test("reports missing symbol references", async () => {
      const doc = await openHaproxyDocument(
        "frontend web\n    use_backend missing\n    http-request deny if missing_acl\n",
      );
      const diagnostics = await waitForSchemaDiagnostics(doc.uri, 2);
      assertDiagnosticCounts(
        diagnostics,
        { "missing-reference": 2 },
        "missing backend and ACL references",
      );
    });

    test("save recomputes diagnostics for file-backed documents", async () => {
      let doc = await openTempFixtureDocument("save-refresh.cfg", "frontend web\n    mode ftp\n");
      let diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assertDiagnosticCounts(diagnostics, { "unknown-value": 1 }, "invalid mode before save");

      doc = await replaceDocumentContent(doc, "frontend web\n    mode http\n");
      const saved = await doc.save();
      assert.strictEqual(saved, true, "Expected temp config save to succeed");
      diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
      const errors = filterDiagnostics(diagnostics, vscode.DiagnosticSeverity.Error);
      assert.strictEqual(errors.length, 0, "Expected no errors after save refresh");
    });

    test("unused symbol diagnostics are on by default", async () => {
      const doc = await openHaproxyDocument(
        "frontend web\n    bind :80\n    acl blocked path_beg /admin\nbackend old_api\n    server s1 127.0.0.1:80\n",
      );
      const diagnostics = await waitForSchemaDiagnostics(doc.uri, 2);
      assertDiagnosticCounts(
        diagnostics,
        { "unused-acl": 1, "unused-section": 1 },
        "unused diagnostics enabled by default",
      );
    });

    test("disabling unused symbol diagnostics suppresses ACL and section hints", async () => {
      const doc = await openHaproxyDocument(
        "frontend web\n    bind :80\n    acl blocked path_beg /admin\nbackend old_api\n    server s1 127.0.0.1:80\n",
      );

      await updateHaproxySetting("diagnostics.unusedSymbols", false);
      const diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
      assert.strictEqual(
        diagnostics.filter((diag) => formatDiagnosticCode(diag.code).startsWith("unused-")).length,
        0,
        "Unused diagnostics should be disabled when setting is false",
      );
    });

    test("warns when frontend has no bind directive", async () => {
      await updateHaproxySetting("diagnostics.unusedSymbols", true);
      const doc = await openHaproxyDocument(
        "defaults default\n    bind :80\nfrontend test_acl from default\n    http-request redirect scheme https if { dst_port -m int 80 }\n",
      );
      const diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assert.strictEqual(
        diagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "no-bind-entry-point")
          .length,
        0,
        "Frontends inheriting bind from defaults should not warn",
      );

      const unreachableDoc = await openHaproxyDocument(
        "frontend test_acl\n    http-request redirect scheme https if { dst_port -m int 80 }\n",
      );
      const unreachableDiagnostics = await waitForSchemaDiagnostics(unreachableDoc.uri, 1);
      assert.strictEqual(
        unreachableDiagnostics.filter(
          (diag) => formatDiagnosticCode(diag.code) === "no-bind-entry-point",
        ).length,
        1,
        "Frontends without bind should warn as unreachable",
      );
    });
  });

  suite("Completion and hover coverage", () => {
    suiteTeardown(async () => {
      await ensureHaproxyVersion("3.2");
    });

    test("file-backed basic-check fixture provides stats hover and tcp-check completion", async () => {
      const doc = await openFixture("valid-basic-check.cfg");
      const statsHover = await hoverTextAt(doc.uri, positionOf(doc, "stats socket"));
      assert.ok(statsHover.length > 0, "Expected stats socket hover");
      assert.ok(statsHover.toLowerCase().includes("stats"), "Expected stats hover text");

      const optionLine = positionOf(doc, "\t\n\tserver");
      const labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(optionLine.line, "\t".length),
      );
      assert.ok(
        labels.some((label) => label.startsWith("tcp-check")),
        `Expected tcp-check directive completion, got: ${labels.join(", ")}`,
      );
    });

    test("mode completion and hover update across supported versions", async () => {
      const doc = await openHaproxyDocument("defaults\n    mode h\n");
      const completionPos = new vscode.Position(1, "    mode h".length);

      await ensureHaproxyVersion("3.2");
      let labels = await completionLabelsAt(doc.uri, completionPos);
      assert.ok(labels.includes("http"), "Expected http completion on 3.2");
      assert.ok(!labels.includes("haterm"), "Did not expect haterm on 3.2");

      let hoverText = await hoverTextAt(doc.uri, new vscode.Position(1, 7));
      assert.ok(!hoverText.includes("haterm"), "Did not expect haterm hover text on 3.2");

      await ensureHaproxyVersion("3.4");
      labels = await completionLabelsAt(doc.uri, completionPos);
      assert.ok(labels.includes("haterm"), "Expected haterm completion on 3.4");

      hoverText = await hoverTextAt(doc.uri, new vscode.Position(1, 7));
      assert.ok(hoverText.includes("haterm"), "Expected haterm hover text on 3.4");
    });

    test("completion covers options and ACL criteria", async () => {
      let doc = await openHaproxyDocument("defaults\n    no option \n");
      let labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    no option ".length),
      );
      assert.ok(labels.includes("httplog"), "Expected option completion for httplog");
      assert.ok(labels.includes("forwardfor"), "Expected option completion for forwardfor");

      doc = await openHaproxyDocument("frontend web\n    acl test \n");
      labels = await completionLabelsAt(doc.uri, new vscode.Position(1, "    acl test ".length));
      assert.ok(labels.includes("path"), "Expected ACL criterion completion for path");
    });

    test("completion covers section headers at top level", async () => {
      let doc = await openHaproxyDocument("");
      let labels = await completionLabelsAt(doc.uri, new vscode.Position(0, 0));
      assert.ok(labels.includes("global"), "Expected global section header on empty file");
      assert.ok(labels.includes("defaults"), "Expected defaults section header on empty file");
      assert.ok(labels.includes("frontend"), "Expected frontend section header on empty file");
      assert.ok(labels.includes("backend"), "Expected backend section header on empty file");

      doc = await openHaproxyDocument("fron");
      labels = await completionLabelsAt(doc.uri, new vscode.Position(0, "fron".length));
      assert.ok(labels.includes("frontend"), "Expected frontend completion for partial fron");
      assert.ok(!labels.includes("backend"), "Did not expect backend for partial fron");

      doc = await openHaproxyDocument("back");
      labels = await completionLabelsAt(doc.uri, new vscode.Position(0, "back".length));
      assert.ok(labels.includes("backend"), "Expected backend completion for partial back");

      doc = await openHaproxyDocument("global");
      labels = await completionLabelsAt(doc.uri, new vscode.Position(0, 1));
      assert.ok(labels.includes("global"), "Expected global when editing a section keyword");

      doc = await openHaproxyDocument("global\n    daemon\n");
      labels = await completionLabelsAt(doc.uri, new vscode.Position(2, 0));
      assert.ok(labels.includes("frontend"), "Expected frontend on blank line between sections");
      assert.ok(labels.includes("defaults"), "Expected defaults on blank line between sections");

      doc = await openHaproxyDocument("defaults\n    mode http\n    \n    balance roundrobin\n");
      labels = await completionLabelsAt(doc.uri, new vscode.Position(2, 4));
      assert.ok(
        labels.includes("balance"),
        "Expected in-section directive on indented blank line inside a section",
      );
      assert.ok(
        !labels.includes("frontend"),
        "Did not expect section header on indented blank line inside a section",
      );

      doc = await openHaproxyDocument("frontend web");
      const sectionNameItems = await completionItemsAt(
        doc.uri,
        new vscode.Position(0, "frontend web".indexOf("web")),
      );
      const sectionHeadersOnName = sectionNameItems.filter(
        (item) => item.detail === "HAProxy section",
      );
      assert.strictEqual(
        sectionHeadersOnName.length,
        0,
        "Did not expect section header completion on section name token",
      );

      doc = await openHaproxyDocument("glob");
      const items = await completionItemsAt(doc.uri, new vscode.Position(0, "glob".length));
      const globalItem = items.find(
        (item) => (typeof item.label === "string" ? item.label : item.label.label) === "global",
      );
      assert.ok(globalItem, "Expected global completion item for partial glob");
      assert.strictEqual(globalItem.detail, "HAProxy section");
    });

    test("completion covers bind options, server option values, and sample converters", async () => {
      let doc = await openHaproxyDocument("frontend web\n    bind 127.0.0.1:80 \n");
      let labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    bind 127.0.0.1:80 ".length),
      );
      assert.ok(labels.includes("ssl"), "Expected bind option completion for ssl");
      assert.ok(labels.includes("interface"), "Expected bind option completion for interface");

      doc = await openHaproxyDocument("backend api\n    server s1 127.0.0.1:80 cookie app01 ins\n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    server s1 127.0.0.1:80 cookie app01 ins".length),
      );
      assert.ok(labels.includes("insert"), "Expected server option value completion");

      doc = await openHaproxyDocument("frontend web\n    http-request set-header X %[path(0):\n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    http-request set-header X %[path(0):".length),
      );
      assert.ok(labels.length > 0, "Expected sample converter completions");
    });

    test("completion covers additional rule and action families", async () => {
      let doc = await openHaproxyDocument("frontend web\n    tcp-request connection \n");
      let labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    tcp-request connection ".length),
      );
      assert.ok(labels.length > 0, "Expected tcp-request action completions");
      assert.ok(!labels.includes("acl"), "Unexpected ACL completion in tcp-request actions");

      doc = await openHaproxyDocument("frontend web\n    http-response set\n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    http-response ".length),
      );
      assert.ok(labels.includes("set-header"), "Expected http-response action completion");

      doc = await openHaproxyDocument("frontend web\n    http-after-response set\n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    http-after-response ".length),
      );
      assert.ok(labels.includes("set-header"), "Expected http-after-response action completion");

      doc = await openHaproxyDocument("frontend web\n    tcp-response content \n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    tcp-response content ".length),
      );
      assert.ok(labels.length > 0, "Expected tcp-response action completions");
      assert.ok(!labels.includes("acl"), "Unexpected ACL completion in tcp-response actions");

      doc = await openHaproxyDocument("frontend web\n    http-request use-service \n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    http-request use-service ".length),
      );
      assert.ok(labels.length > 0, "Expected use-service completions");
    });

    test("hover covers option, action, and sample fetch docs", async () => {
      let doc = await openHaproxyDocument("defaults\n    option httplog\n");
      let text = await hoverTextAt(doc.uri, new vscode.Position(1, "    option h".length));
      assert.ok(text.includes("Valid in sections:"), "Expected option hover metadata");

      doc = await openHaproxyDocument("frontend web\n    http-request deny\n");
      text = await hoverTextAt(doc.uri, new vscode.Position(1, "    http-request d".length));
      assert.ok(text.toLowerCase().includes("deny"), "Expected action hover for deny");
      assert.ok(text.toLowerCase().includes("reject"), "Expected deny description");

      doc = await openHaproxyDocument(
        "frontend web\n    http-request set-header X-Test %[req.hdr(host)]\n",
      );
      text = await hoverTextAt(doc.uri, new vscode.Position(1, 39));
      assert.ok(text.toLowerCase().includes("req.hdr"), "Expected sample fetch hover");
      assert.ok(text.toLowerCase().includes("returns"), "Expected sample fetch description");
    });

    test("hover covers additional rule and action families", async () => {
      let doc = await openHaproxyDocument("frontend web\n    http-request track-sc1 src\n");
      let text = await hoverTextAt(doc.uri, new vscode.Position(1, "    http-request ".length + 2));
      assert.ok(text.includes("track-sc1"), "Expected track-sc1 hover");
      assert.ok(text.toLowerCase().includes("sticky"), "Expected sticky-counter description");

      doc = await openHaproxyDocument("frontend web\n    http-request set-path /api\n");
      text = await hoverTextAt(doc.uri, new vscode.Position(1, "    http-request ".length + 2));
      assert.ok(text.includes("set-path"), "Expected set-path hover");
      assert.ok(text.toLowerCase().includes("rewrites"), "Expected set-path description");

      doc = await openHaproxyDocument('defaults\n    log-format "%{+Q}o %ci"\n');
      text = await hoverTextAt(doc.uri, new vscode.Position(1, '    log-format "%{+Q}o %'.length));
      assert.ok(text.includes("%ci"), "Expected log-format alias hover");
    });
  });

  suite("Formatting", () => {
    suiteTeardown(async () => {
      await updateHaproxySetting("format.enabled", true);
      await updateHaproxySetting("format.indent", "spaces-4");
      await updateHaproxySetting("format.insertBlankLineBetweenSections", true);
    });

    test("tab indentation is honored by format document", async () => {
      await updateHaproxySetting("format.enabled", true);
      await updateHaproxySetting("format.indent", "tab");
      const formatted = await formatDocumentContent(
        "frontend web\n      bind :443 # keep comment\n",
      );
      assert.strictEqual(formatted, "frontend web\n\tbind :443 # keep comment\n");
    });
  });

  suite("Supported version bundle smoke tests", () => {
    test("completion, hover, and diagnostics work across every bundled version", async function () {
      this.timeout(90000);

      for (const version of ["2.6", "2.8", "3.0", "3.2", "3.4"]) {
        await ensureHaproxyVersion(version);
        const doc = await openHaproxyDocument("defaults\n    mode http\n");

        const diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
        const errors = filterDiagnostics(diagnostics, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(errors.length, 0, `Expected no errors on ${version}`);

        const labels = await completionLabelsAt(
          doc.uri,
          new vscode.Position(1, "    mode ".length),
        );
        assert.ok(labels.includes("http"), `Expected http completion on ${version}`);

        const hoverText = await hoverTextAt(doc.uri, new vscode.Position(1, 7));
        assert.ok(hoverText.length > 0, `Expected non-empty hover on ${version}`);
      }
    });
  });
});
