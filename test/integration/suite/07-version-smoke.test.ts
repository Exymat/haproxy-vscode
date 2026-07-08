import * as assert from "node:assert";
import * as vscode from "vscode";

import {
  completionLabelsAt,
  ensureHaproxyVersion,
  filterDiagnostics,
  hoverTextAt,
  openHaproxyDocument,
  resetHaproxySettings,
  waitForSchemaDiagnostics,
} from "./helpers";

suite("Supported version bundle smoke tests", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  test("completion, hover, and diagnostics work across every bundled version", async function () {
    this.timeout(90000);

    for (const version of ["2.6", "2.8", "3.0", "3.2", "3.4"]) {
      await ensureHaproxyVersion(version);
      const doc = await openHaproxyDocument("defaults\n    mode http\n");

      const diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
      const errors = filterDiagnostics(diagnostics, vscode.DiagnosticSeverity.Error);
      assert.strictEqual(errors.length, 0, `Expected no errors on ${version}`);

      const labels = await completionLabelsAt(doc.uri, new vscode.Position(1, "    mode ".length));
      assert.ok(labels.includes("http"), `Expected http completion on ${version}`);

      const hoverText = await hoverTextAt(doc.uri, new vscode.Position(1, 7));
      assert.ok(hoverText.length > 0, `Expected non-empty hover on ${version}`);
    }
  });
});
