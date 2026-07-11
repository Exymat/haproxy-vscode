import * as assert from "node:assert";
import * as vscode from "vscode";

import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import {
  ensureHaproxyVersion,
  fixturePath,
  openFixture,
  pathSuffix,
  positionOf,
  resetHaproxySettings,
  updateHaproxySetting,
  waitForDefinitionTarget,
  waitForDiagnosticCode,
  waitForHoverTextContaining,
  waitForNoDiagnosticCode,
  waitForReferenceUris,
} from "./helpers";

suite("Workspace symbols E2E", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
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
    await resetHaproxySettings();
  });

  test("cross-file definition, references, and hover use the workspace graph", async () => {
    const frontend = await openFixture("workspace-symbols/frontends/web.cfg");
    const backendTarget = await waitForDefinitionTarget(
      frontend.uri,
      positionOf(frontend, "api"),
      "/workspace-symbols/backends/api.cfg",
    );
    assert.strictEqual(backendTarget.length, 1, "Expected one cross-file backend definition");
    assert.ok(backendTarget[0]?.uri.toString().endsWith("/workspace-symbols/backends/api.cfg"));

    const backend = await vscode.workspace.openTextDocument(
      vscode.Uri.file(fixturePath("workspace-symbols/backends/api.cfg")),
    );
    const references = await waitForReferenceUris(backend.uri, positionOf(backend, "api"), [
      "/workspace-symbols/backends/api.cfg",
      "/workspace-symbols/frontends/web.cfg",
    ]);
    assert.deepStrictEqual(
      references.map((location) => pathSuffix(location.uri)).sort(),
      ["/workspace-symbols/backends/api.cfg", "/workspace-symbols/frontends/web.cfg"].sort(),
    );

    const text = await waitForHoverTextContaining(
      frontend.uri,
      positionOf(frontend, "api"),
      "backend api\n    server s1 127.0.0.1:80 resolvers dns-main",
    );
    assert.ok(text.includes("```haproxy"), `Expected HAProxy code preview, got ${text}`);
  });

  test("workspace diagnostics consume cross-file definitions", async () => {
    const frontend = await openFixture("workspace-symbols/frontends/web.cfg");
    const frontendDiagnostics = await waitForNoDiagnosticCode(frontend.uri, "missing-reference");
    assert.strictEqual(
      frontendDiagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "missing-reference")
        .length,
      0,
      "Expected no missing references in frontend",
    );

    const duplicate = await openFixture("workspace-symbols/backends/duplicate-a.cfg");
    const duplicateDiagnostics = await waitForDiagnosticCode(duplicate.uri, "duplicate-section");
    assert.strictEqual(
      duplicateDiagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "duplicate-section")
        .length,
      1,
      "Expected duplicate-section from workspace graph",
    );
  });

  test("configured globs resolve split haproxy.d layouts", async () => {
    await updateHaproxySetting("workspaceSymbols.maxFiles", 0);
    await updateHaproxySetting("workspaceSymbols.maxTotalLines", 0);
    await updateHaproxySetting("workspaceSymbols.include", [
      "**/haproxy-tests/haproxy.d/**/*.cfg",
      "**/haproxy-tests/haproxy.d/*.cfg",
      "**/*.cfg",
    ]);

    const frontend = await openFixture("haproxy-tests/haproxy.d/frontends/FE_WWW.cfg");
    const diagnostics = await waitForNoDiagnosticCode(frontend.uri, "missing-reference");
    assert.strictEqual(
      diagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "missing-reference").length,
      0,
      "Expected split frontend references to resolve",
    );
  });
});
