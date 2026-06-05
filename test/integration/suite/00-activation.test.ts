import * as assert from "node:assert";
import * as vscode from "vscode";

import { haproxyDiagnostics, openFixture } from "./helpers";

const EXTENSION_ID = "Exymat.haproxy-config";

suite("Extension activation", () => {
  test("extension is present", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} not found`);
  });

  test("extension activates on haproxy file", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    assert.strictEqual(ext.isActive, true, "Extension did not activate");
  });
});

suite("Language features on sample.cfg", () => {
  let doc: vscode.TextDocument;

  suiteSetup(async () => {
    doc = await openFixture("sample.cfg");
  });

  test("document language is haproxy", () => {
    assert.strictEqual(doc.languageId, "haproxy");
  });

  test("no diagnostics on valid sample config", () => {
    const errors = haproxyDiagnostics(vscode.languages.getDiagnostics(doc.uri)).filter(
      (d) => d.severity === vscode.DiagnosticSeverity.Error,
    );
    assert.strictEqual(
      errors.length,
      0,
      `Unexpected errors: ${errors.map((e) => e.message).join(", ")}`,
    );
  });

  test("completion items available in defaults section", async () => {
    const pos = new vscode.Position(5, 4);
    const items = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      doc.uri,
      pos,
    );
    assert.ok(items && items.items.length > 0, "No completion items returned");
  });

  test("hover returns content on balance directive", async () => {
    const lines = doc.getText().split("\n");
    const balanceLine = lines.findIndex((line) => line.trim().startsWith("balance roundrobin"));
    assert.ok(balanceLine >= 0, "balance directive not found in fixture");

    const pos = new vscode.Position(balanceLine, 6);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      doc.uri,
      pos,
    );
    assert.ok(hovers && hovers.length > 0, "No hover result");
    const content = hovers[0].contents
      .map((c) => (typeof c === "string" ? c : "value" in c ? c.value : ""))
      .join("");
    assert.ok(content.length > 0, "Empty hover content");
    assert.ok(content.includes("Valid in modes:"), "Expected mode-context line in hover");
  });

  test("HAProxy version command is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("haproxy.selectVersion"),
      "haproxy.selectVersion command not registered",
    );
  });
});
