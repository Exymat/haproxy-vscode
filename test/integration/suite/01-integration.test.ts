import * as assert from "node:assert";
import * as vscode from "vscode";

import {
  assertDiagnosticCounts,
  ensureHaproxyVersion,
  filterDiagnostics,
  formatDocumentContent,
  haproxyDiagnostics,
  openFixture,
  openHaproxyDocument,
  resetHaproxySettings,
  updateHaproxySetting,
  waitForDiagnosticsReady,
  waitForSchemaDiagnostics,
} from "./helpers";

const MESSY_CONFIG = "     frontend         foo\n     mode             http   # or tcp\n";

suite("Integration coverage", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await resetHaproxySettings();
  });

  suite("Schema diagnostics", () => {
    suiteTeardown(async () => {
      await updateHaproxySetting("diagnostics.enabled", true);
      await updateHaproxySetting("diagnostics.maxLines", 4000);
    });

    test("reports unknown-option errors", async () => {
      const doc = await openFixture("unknown-option.cfg");
      const diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assertDiagnosticCounts(diagnostics, { "unknown-option": 1 }, "unknown defaults option");
    });

    test("reports wrong-section errors", async () => {
      const doc = await openFixture("wrong-section.cfg");
      const diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assertDiagnosticCounts(diagnostics, { "wrong-section": 1 }, "external-check in frontend");
    });

    test("reports listen-section schema errors", async () => {
      const doc = await openFixture("listen-invalid.cfg");
      const diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assertDiagnosticCounts(
        diagnostics,
        {
          "unknown-value": 1,
          "unknown-keyword": 1,
          "unknown-criterion": 1,
          "unknown-action": 1,
        },
        "invalid listen section",
      );
    });

    test("reports wrong-context errors", async () => {
      const doc = await openFixture("wrong-context.cfg");
      const diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assertDiagnosticCounts(diagnostics, { "wrong-context": 1 }, "http-only keyword in tcp mode");
    });

    test("clears diagnostics when diagnostics are disabled", async () => {
      const doc = await openFixture("unknown-option.cfg");
      const before = await waitForSchemaDiagnostics(doc.uri);
      assert.ok(before.length > 0, "Expected diagnostics before disabling diagnostics");

      await updateHaproxySetting("diagnostics.enabled", false);
      const after = haproxyDiagnostics(vscode.languages.getDiagnostics(doc.uri));
      assert.strictEqual(after.length, 0, "Diagnostics should be cleared when disabled");
    });

    test("skips diagnostics when document exceeds maxLines", async () => {
      await updateHaproxySetting("diagnostics.enabled", true);
      await updateHaproxySetting("diagnostics.maxLines", 100, 1000);
      const doc = await openFixture("diagnostics-long.cfg");
      assert.ok(doc.lineCount > 100, "Fixture should exceed the configured maxLines");
      await waitForDiagnosticsReady(500);
      const diags = haproxyDiagnostics(vscode.languages.getDiagnostics(doc.uri));
      assert.strictEqual(diags.length, 0, "Diagnostics should be skipped above maxLines");
    });
  });

  suite("HAProxy version switching", () => {
    suiteSetup(async () => {
      await updateHaproxySetting("diagnostics.enabled", true);
      await ensureHaproxyVersion("3.2");
    });

    test("reports unknown mode values on 3.2", async () => {
      const version = vscode.workspace.getConfiguration("haproxy").get<string>("version");
      assert.strictEqual(version, "3.2");

      const doc = await openFixture("unknown-mode.cfg");
      const diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assertDiagnosticCounts(diagnostics, { "unknown-value": 1 }, "mode ftp on 3.2");
    });

    test("mode haterm becomes valid after switching to 3.4", async () => {
      const doc = await openHaproxyDocument("frontend x\n\tmode haterm\n");
      await updateHaproxySetting("version", "3.4", 3000);

      const version = vscode.workspace.getConfiguration("haproxy").get<string>("version");
      assert.strictEqual(version, "3.4");

      const errors = filterDiagnostics(
        haproxyDiagnostics(vscode.languages.getDiagnostics(doc.uri)),
        vscode.DiagnosticSeverity.Error,
      );
      assert.strictEqual(
        errors.length,
        0,
        `Expected no errors on 3.4, got: ${errors.map((e) => e.message).join(", ")}`,
      );

      await ensureHaproxyVersion("3.2");
    });
  });

  suite("Deprecated warnings", () => {
    suiteSetup(async function () {
      this.timeout(60000);
      await updateHaproxySetting("diagnostics.enabled", true);
      await updateHaproxySetting("diagnostics.deprecatedWarnings", true);
      await ensureHaproxyVersion("3.4");
    });

    suiteTeardown(async () => {
      await updateHaproxySetting("diagnostics.deprecatedWarnings", true);
      await ensureHaproxyVersion("3.2");
    });

    test("warns on deprecated master-worker directive", async () => {
      const doc = await openFixture("deprecated-master-worker.cfg");
      const warnings = filterDiagnostics(
        haproxyDiagnostics(vscode.languages.getDiagnostics(doc.uri)),
        vscode.DiagnosticSeverity.Warning,
      );
      assertDiagnosticCounts(warnings, { "deprecated-keyword": 1 }, "deprecated master-worker");
    });

    test("suppresses warnings when expose-deprecated-directives is set", async () => {
      const doc = await openFixture("deprecated-suppressed.cfg");
      const warnings = filterDiagnostics(
        haproxyDiagnostics(vscode.languages.getDiagnostics(doc.uri)),
        vscode.DiagnosticSeverity.Warning,
      );
      assert.strictEqual(
        warnings.length,
        0,
        `Expected no deprecated warnings, got: ${warnings.map((w) => w.message).join(", ")}`,
      );
    });

    test("omits deprecated warnings when setting is disabled", async () => {
      await updateHaproxySetting("diagnostics.deprecatedWarnings", false);
      const doc = await openFixture("deprecated-master-worker.cfg");
      const warnings = filterDiagnostics(
        haproxyDiagnostics(vscode.languages.getDiagnostics(doc.uri)),
        vscode.DiagnosticSeverity.Warning,
      );
      assert.strictEqual(
        warnings.length,
        0,
        `Expected no warnings with deprecatedWarnings disabled, got: ${warnings.map((w) => w.message).join(", ")}`,
      );
    });
  });

  suite("Document formatting", () => {
    suiteSetup(async () => {
      await updateHaproxySetting("format.enabled", true);
      await updateHaproxySetting("format.indent", "spaces-4");
      await updateHaproxySetting("format.insertBlankLineBetweenSections", true);
    });

    test("formats messy config with default settings", async () => {
      const formatted = await formatDocumentContent(MESSY_CONFIG);
      assert.strictEqual(formatted, "frontend foo\n    mode http # or tcp\n");
    });

    test("respects spaces-2 indent setting", async () => {
      await updateHaproxySetting("format.indent", "spaces-2");
      const formatted = await formatDocumentContent(MESSY_CONFIG);
      assert.ok(formatted.includes("  mode http"), `Expected 2-space indent, got:\n${formatted}`);
    });

    test("omits blank lines between sections when disabled", async () => {
      await updateHaproxySetting("format.insertBlankLineBetweenSections", false);
      const formatted = await formatDocumentContent(
        "global\n    daemon\ndefaults\n    mode http\n",
      );
      assert.ok(!formatted.includes("\n\ndefaults"), `Unexpected blank line:\n${formatted}`);
    });

    test("returns no edits when formatting is disabled", async () => {
      await updateHaproxySetting("format.enabled", false);
      const doc = await openFixture("messy-format.cfg");
      const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
        "vscode.executeFormatDocumentProvider",
        doc.uri,
      );
      assert.ok(!edits || edits.length === 0, "Format provider should return no edits");
    });
  });
});
