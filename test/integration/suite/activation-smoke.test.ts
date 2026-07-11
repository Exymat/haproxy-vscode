import * as assert from "node:assert";
import * as vscode from "vscode";

import {
  assertHaproxyLanguage,
  ensureHaproxyVersion,
  haproxyDiagnostics,
  openFixture,
  resetHaproxySettings,
} from "./helpers";

const EXTENSION_ID = "Exymat.haproxy-config";

suite("Activation smoke", () => {
  suiteSetup(async function () {
    this.timeout(30000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await resetHaproxySettings();
  });

  test("extension activates and registers contributed commands", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} not found`);
    await ext.activate();
    assert.strictEqual(ext.isActive, true, "Extension did not activate");

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("haproxy.selectVersion"),
      "haproxy.selectVersion command not registered",
    );
  });

  test("sample config opens with language, diagnostics, completion, and hover wired", async () => {
    const doc = await openFixture("sample.cfg");
    assertHaproxyLanguage(doc);

    const errors = haproxyDiagnostics(vscode.languages.getDiagnostics(doc.uri)).filter(
      (diag) => diag.severity === vscode.DiagnosticSeverity.Error,
    );
    assert.strictEqual(
      errors.length,
      0,
      `Unexpected sample.cfg errors: ${errors.map((diag) => diag.message).join(", ")}`,
    );

    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      doc.uri,
      new vscode.Position(5, 4),
    );
    assert.ok(completions && completions.items.length > 0, "No completion items returned");

    const balanceLine = doc
      .getText()
      .split("\n")
      .findIndex((line) => line.trim().startsWith("balance roundrobin"));
    assert.ok(balanceLine >= 0, "balance directive not found in fixture");

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      doc.uri,
      new vscode.Position(balanceLine, 6),
    );
    assert.ok(hovers && hovers.length > 0, "No hover result");
  });
});
