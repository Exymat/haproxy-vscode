import * as assert from "node:assert";
import * as vscode from "vscode";

import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import {
  definitionLocationsAt,
  ensureHaproxyVersion,
  fixturePath,
  NAVIGATION_CONFIG,
  openFixture,
  openHaproxyDocument,
  pathSuffix,
  positionOf,
  referenceLocationsAt,
  renameEditsAt,
  resetHaproxySettings,
  updateHaproxySetting,
  waitForDefinitionTarget,
  waitForDiagnosticCode,
  waitForHoverTextContaining,
  waitForNoDiagnosticCode,
  waitForReferenceUris,
} from "./helpers";

suite("Navigation providers", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
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

    test("hover shows cross-file symbol definition previews", async () => {
      const frontend = await openFixture("workspace-symbols/frontends/web.cfg");
      const text = await waitForHoverTextContaining(
        frontend.uri,
        positionOf(frontend, "api"),
        "backend api\n    server s1 127.0.0.1:80 resolvers dns-main",
      );

      assert.ok(text.includes("```haproxy"), `Expected HAProxy code preview in hover, got ${text}`);
      assert.ok(
        !text.toLowerCase().includes("use_backend"),
        `Expected symbol preview instead of use_backend docs, got ${text}`,
      );
    });

    test("diagnostics use workspace definitions and references", async () => {
      const frontend = await openFixture("workspace-symbols/frontends/web.cfg");
      const frontendDiagnostics = await waitForNoDiagnosticCode(frontend.uri, "missing-reference");
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
        secondDiagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "duplicate-section")
          .length,
        1,
        `Expected duplicate-section in second duplicate backend, got ${secondDiagnostics
          .map((diag) => `[${formatDiagnosticCode(diag.code)}] ${diag.message}`)
          .join(", ")}`,
      );
    });

    test("diagnostics resolve split haproxy.d layouts with configured globs", async () => {
      await updateHaproxySetting("workspaceSymbols.maxFiles", 0);
      await updateHaproxySetting("workspaceSymbols.maxTotalLines", 0);
      await updateHaproxySetting("workspaceSymbols.include", [
        "**/haproxy-tests/haproxy.d/**/*.cfg",
        "**/haproxy-tests/haproxy.d/*.cfg",
        "**/*.cfg",
      ]);

      const frontend = await openFixture("haproxy-tests/haproxy.d/frontends/FE_WWW.cfg");
      const frontendDiagnostics = await waitForNoDiagnosticCode(frontend.uri, "missing-reference");
      assert.strictEqual(
        frontendDiagnostics.filter(
          (diag) => formatDiagnosticCode(diag.code) === "missing-reference",
        ).length,
        0,
        `Expected split frontend references to resolve, got ${frontendDiagnostics
          .map((diag) => `[${formatDiagnosticCode(diag.code)}] ${diag.message}`)
          .join(", ")}`,
      );

      const backend = await openFixture("haproxy-tests/haproxy.d/backends/BE_WWW.cfg");
      const backendDiagnostics = await waitForNoDiagnosticCode(backend.uri, "unused-section");
      assert.strictEqual(
        backendDiagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "unused-section")
          .length,
        0,
        `Expected split backend usage to resolve, got ${backendDiagnostics
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

    const defs = await definitionLocationsAt(doc.uri, new vscode.Position(2, '    log "${'.length));
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
    references = await referenceLocationsAt(doc.uri, new vscode.Position(0, "peers ".length), true);
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
