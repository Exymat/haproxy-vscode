import * as assert from "node:assert";
import * as vscode from "vscode";

import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import {
  assertDiagnosticCounts,
  clearHaproxySetting,
  ensureHaproxyVersion,
  filterDiagnostics,
  haproxyDiagnostics,
  openFixture,
  openHaproxyDocument,
  openTempFixtureDocument,
  replaceDocumentContent,
  resetHaproxySettings,
  updateHaproxySetting,
  waitForDiagnosticsReady,
  waitForSchemaDiagnostics,
} from "./helpers";

suite("Diagnostics lifecycle", () => {
  suiteSetup(async function () {
    this.timeout(30000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await clearHaproxySetting("diagnostics.unusedSymbols.sections");
    await resetHaproxySettings();
  });

  test("diagnostics refresh after edits and saves", async () => {
    let doc = await openHaproxyDocument("frontend web\n    mode ftp\n");
    let diagnostics = await waitForSchemaDiagnostics(doc.uri);
    assertDiagnosticCounts(diagnostics, { "unknown-value": 1 }, "invalid mode before edit");

    doc = await replaceDocumentContent(doc, "frontend web\n    mode http\n");
    diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
    assert.strictEqual(
      filterDiagnostics(diagnostics, vscode.DiagnosticSeverity.Error).length,
      0,
      "Expected diagnostics to clear after edit",
    );

    let fileDoc = await openTempFixtureDocument("save-refresh.cfg", "frontend web\n    mode ftp\n");
    diagnostics = await waitForSchemaDiagnostics(fileDoc.uri);
    assertDiagnosticCounts(diagnostics, { "unknown-value": 1 }, "invalid mode before save");

    fileDoc = await replaceDocumentContent(fileDoc, "frontend web\n    mode http\n");
    assert.strictEqual(await fileDoc.save(), true, "Expected temp config save to succeed");
    diagnostics = await waitForSchemaDiagnostics(fileDoc.uri, 0);
    assert.strictEqual(
      filterDiagnostics(diagnostics, vscode.DiagnosticSeverity.Error).length,
      0,
      "Expected diagnostics to clear after save",
    );
  });

  test("diagnostic settings clear or skip published diagnostics", async () => {
    const doc = await openFixture("unknown-option.cfg");
    const before = await waitForSchemaDiagnostics(doc.uri);
    assert.ok(before.length > 0, "Expected diagnostics before disabling diagnostics");

    await updateHaproxySetting("diagnostics.enabled", false);
    assert.strictEqual(
      haproxyDiagnostics(vscode.languages.getDiagnostics(doc.uri)).length,
      0,
      "Diagnostics should be cleared when disabled",
    );

    await updateHaproxySetting("diagnostics.enabled", true);
    await updateHaproxySetting("diagnostics.maxLines", 100);
    const longDoc = await openFixture("diagnostics-long.cfg");
    assert.ok(longDoc.lineCount > 100, "Fixture should exceed the configured maxLines");
    await waitForDiagnosticsReady();
    assert.strictEqual(
      haproxyDiagnostics(vscode.languages.getDiagnostics(longDoc.uri)).length,
      0,
      "Diagnostics should be skipped above maxLines",
    );
  });

  test("unused-symbol setting suppresses published ACL and section hints", async () => {
    const doc = await openHaproxyDocument(
      "frontend web\n    bind :80\n    acl blocked path_beg /admin\nbackend old_api\n    server s1 127.0.0.1:80\n",
    );
    let diagnostics = await waitForSchemaDiagnostics(doc.uri, 2);
    assertDiagnosticCounts(
      diagnostics,
      { "unused-acl": 1, "unused-section": 1 },
      "unused diagnostics enabled by default",
    );

    await updateHaproxySetting("diagnostics.unusedSymbols", false);
    diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
    assert.strictEqual(
      diagnostics.filter((diag) => formatDiagnosticCode(diag.code).startsWith("unused-")).length,
      0,
      "Unused diagnostics should be disabled when setting is false",
    );
  });
});
