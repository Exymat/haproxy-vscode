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

suite("Outline, folding, and formatting", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await resetHaproxySettings();
    await updateHaproxySetting("format.enabled", true);
    await updateHaproxySetting("format.indent", "spaces-4");
    await updateHaproxySetting("format.insertBlankLineBetweenSections", true);
  });

  test("document symbols expose top-level section outline", async () => {
    const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
    const symbols = await vscode.commands.executeCommand<
      Array<vscode.DocumentSymbol | vscode.SymbolInformation>
    >("vscode.executeDocumentSymbolProvider", doc.uri);

    assert.ok(symbols && symbols.length >= 3, "Expected section symbols");
    const names = symbols.map((symbol) => symbol.name);
    assert.deepStrictEqual(names.slice(0, 3), [
      "defaults profile_default",
      "frontend web from profile_default",
      "backend api",
    ]);
  });

  test("folding ranges cover section bodies", async () => {
    const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
    const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
      "vscode.executeFoldingRangeProvider",
      doc.uri,
    );

    assert.ok(ranges && ranges.length >= 3, "Expected folding ranges");
    assert.ok(
      ranges.some((range) => range.start === 0 && range.end === 1),
      "Expected defaults folding range",
    );
    assert.ok(
      ranges.some((range) => range.start === 2 && range.end === 5),
      "Expected frontend folding range",
    );
    assert.ok(
      ranges.some((range) => range.start === 6 && range.end === 8),
      "Expected backend folding range",
    );
  });

  test("tab indentation is honored by format document", async () => {
    await updateHaproxySetting("format.enabled", true);
    await updateHaproxySetting("format.indent", "tab");
    const formatted = await formatDocumentContent("frontend web\n      bind :443 # keep comment\n");
    assert.strictEqual(formatted, "frontend web\n\tbind :443 # keep comment\n");
  });
});
