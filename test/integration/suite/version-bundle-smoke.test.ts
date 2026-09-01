import * as assert from "node:assert";
import * as vscode from "vscode";

import {
  completionLabelsAt,
  ensureHaproxyEdition,
  ensureHaproxyVersion,
  filterDiagnostics,
  hoverTextAt,
  openHaproxyDocument,
  resetHaproxySettings,
  waitForSchemaDiagnostics,
} from "./helpers";

suite("Version bundle smoke", () => {
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

  test("HAPEE profiles select dedicated grammars and Enterprise language data", async function () {
    this.timeout(90000);

    await ensureHaproxyEdition("hapee");
    for (const version of ["2.6", "2.8", "3.0", "3.2"]) {
      await ensureHaproxyVersion(version);
      const doc = await openHaproxyDocument("global\n    module-load example.so\n");

      assert.strictEqual(doc.languageId, `haproxy-${version}r1`);
      const diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
      const unknownDirectiveErrors = filterDiagnostics(
        diagnostics,
        vscode.DiagnosticSeverity.Error,
      ).filter((diagnostic) => diagnostic.code === "unknown-directive");
      assert.strictEqual(
        unknownDirectiveErrors.length,
        0,
        `Expected module-load to be recognized on ${version}r1`,
      );

      const labels = await completionLabelsAt(doc.uri, new vscode.Position(1, 4));
      assert.ok(labels.includes("module-load"), `Expected module-load completion on ${version}r1`);

      const hoverText = await hoverTextAt(doc.uri, new vscode.Position(1, 7));
      assert.ok(hoverText.length > 0, `Expected module-load hover on ${version}r1`);
    }
  });
});
