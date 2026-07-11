import * as assert from "node:assert";
import * as vscode from "vscode";

import {
  ensureHaproxyVersion,
  formatDocumentContent,
  NAVIGATION_CONFIG,
  openHaproxyDocument,
  resetHaproxySettings,
  updateHaproxySetting,
} from "./helpers";

suite("Provider command smoke", () => {
  suiteSetup(async function () {
    this.timeout(30000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await resetHaproxySettings();
  });

  test("outline and folding providers are reachable through VS Code commands", async () => {
    const doc = await openHaproxyDocument(NAVIGATION_CONFIG);

    const symbols = await vscode.commands.executeCommand<
      Array<vscode.DocumentSymbol | vscode.SymbolInformation>
    >("vscode.executeDocumentSymbolProvider", doc.uri);
    assert.ok(symbols && symbols.length >= 3, "Expected section symbols");
    assert.deepStrictEqual(
      symbols.slice(0, 3).map((symbol) => symbol.name),
      ["defaults profile_default", "frontend web from profile_default", "backend api"],
    );

    const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
      "vscode.executeFoldingRangeProvider",
      doc.uri,
    );
    assert.ok(ranges && ranges.length >= 3, "Expected folding ranges");
    assert.ok(ranges.some((range) => range.start === 0 && range.end === 1));
    assert.ok(ranges.some((range) => range.start === 2 && range.end === 5));
    assert.ok(ranges.some((range) => range.start === 6 && range.end === 8));
  });

  test("formatting settings flow through the registered format provider", async () => {
    await updateHaproxySetting("format.enabled", true);
    await updateHaproxySetting("format.indent", "tab");

    const formatted = await formatDocumentContent("frontend web\n      bind :443 # keep comment\n");
    assert.strictEqual(formatted, "frontend web\n\tbind :443 # keep comment\n");
  });

  test("editor Go to Definition command navigates within an open document", async () => {
    const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
    const editor = await vscode.window.showTextDocument(doc);
    const refPosition = new vscode.Position(5, "    use_backend ".length + 1);
    editor.selection = new vscode.Selection(refPosition, refPosition);

    await vscode.commands.executeCommand("editor.action.revealDefinition");

    const active = vscode.window.activeTextEditor;
    assert.ok(active, "Expected an active editor after Go to Definition");
    assert.strictEqual(active.document.uri.toString(), doc.uri.toString());
    assert.strictEqual(active.selection.active.line, 6);
    assert.strictEqual(active.selection.active.character, "backend ".length);
  });
});
