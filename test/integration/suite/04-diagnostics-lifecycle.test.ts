import * as assert from "node:assert";
import * as vscode from "vscode";

import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import {
  assertDiagnosticCounts,
  clearHaproxySetting,
  ensureHaproxyVersion,
  filterDiagnostics,
  openHaproxyDocument,
  openTempFixtureDocument,
  replaceDocumentContent,
  resetHaproxySettings,
  updateHaproxySetting,
  waitForSchemaDiagnostics,
} from "./helpers";

suite("Diagnostics lifecycle", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await updateHaproxySetting("diagnostics.enabled", true);
    await clearHaproxySetting("diagnostics.unusedSymbols.sections");
    await updateHaproxySetting("diagnostics.unusedSymbols", true);
    await resetHaproxySettings();
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
