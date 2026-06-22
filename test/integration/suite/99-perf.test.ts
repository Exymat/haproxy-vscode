import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  benchFixturePath,
  measureAsync,
  type PerfReportEntry,
  writePerfReport,
} from "../../bench/helpers";
import { fixturePath, waitForSchemaDiagnostics } from "./helpers";

const runPerf = process.env.HAPROXY_PERF_BENCH === "1";
const EXTENSION_ID = "Exymat.haproxy-config";
const reportPath = path.resolve(__dirname, "../../../../scripts/reports/perf-integration.json");

const testFn = runPerf ? test : test.skip;

suite("Perf", function () {
  this.timeout(120000);

  const results: PerfReportEntry[] = [];

  suiteTeardown(() => {
    if (!runPerf || results.length === 0) {
      return;
    }
    writePerfReport(reportPath, results);
  });

  testFn("activation to first completion", async () => {
    const stats = await measureAsync(
      async () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(ext, `Extension ${EXTENSION_ID} not found`);
        await ext.activate();
        assert.strictEqual(ext.isActive, true, "Extension did not activate");

        const uri = vscode.Uri.file(fixturePath("sample.cfg"));
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);

        const deadline = Date.now() + 10000;
        let ready = false;
        while (Date.now() < deadline) {
          const items = await vscode.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider",
            doc.uri,
            new vscode.Position(0, 0),
          );
          if (items && items.items.length > 0) {
            ready = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(ready, "Completion provider did not become ready");
      },
      { warmup: 0, iterations: 1 },
    );

    results.push({
      name: "activation_to_first_completion",
      unit: "ms",
      stats,
    });
  });

  testFn("hover E2E on balance directive", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();

    const uri = vscode.Uri.file(fixturePath("sample.cfg"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const lines = doc.getText().split("\n");
    const balanceLine = lines.findIndex((line) => line.trim().startsWith("balance roundrobin"));
    assert.ok(balanceLine >= 0, "balance directive not found in fixture");
    const pos = new vscode.Position(balanceLine, 6);

    const stats = await measureAsync(
      async () => {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          doc.uri,
          pos,
        );
        assert.ok(hovers && hovers.length > 0, "No hover result");
      },
      { warmup: 2, iterations: 10 },
    );

    results.push({
      name: "hover_e2e_balance",
      unit: "ms",
      stats,
    });
  });

  testFn("open large config until diagnostics stabilize", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();

    const largePath = benchFixturePath("large-valid.cfg");
    const uri = vscode.Uri.file(largePath);

    const stats = await measureAsync(
      async () => {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        assert.strictEqual(doc.languageId, "haproxy");
        await waitForSchemaDiagnostics(uri, 0, 20000);
      },
      { warmup: 0, iterations: 2 },
    );

    results.push({
      name: "open_large_cfg_diagnostics",
      unit: "ms",
      stats,
      metadata: {
        fixture: "test/bench/fixtures/large-valid.cfg",
        lineCount: (await vscode.workspace.openTextDocument(uri)).lineCount,
      },
    });
  });
});
