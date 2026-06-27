"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const reportPath = process.env.HAPROXY_TAG_BENCH_REPORT_PATH;
const testRoot = process.env.HAPROXY_TAG_BENCH_TEST_ROOT;
const versionSetting = process.env.HAPROXY_TAG_BENCH_VERSION || "3.2";

if (!reportPath) {
  throw new Error("HAPROXY_TAG_BENCH_REPORT_PATH is required");
}

if (!testRoot) {
  throw new Error("HAPROXY_TAG_BENCH_TEST_ROOT is required");
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function measure(label, fn, options = {}) {
  const warmup = options.warmup ?? 2;
  const iterations = options.iterations ?? 10;

  for (let i = 0; i < warmup; i += 1) {
    await fn();
  }

  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    label,
    status: "ok",
    unit: "ms",
    stats: {
      count: sorted.length,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      mean: total / sorted.length,
      median: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    },
  };
}

async function safeMeasure(label, fn, options = {}) {
  try {
    return await measure(label, fn, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("not found") ||
      message.includes("made no changes") ||
      message.includes("No active editor") ||
      message.includes("returned no items") ||
      message.includes("returned no edits") ||
      message.includes("returned no locations")
    ) {
      return {
        label,
        status: "unavailable",
        reason: message,
      };
    }
    throw error;
  }
}

function fixturePath(relativePath) {
  return path.join(testRoot, relativePath);
}

function getExtension() {
  const extension = vscode.extensions.all.find(
    (item) => item.packageJSON?.name === "haproxy-config",
  );
  assert.ok(extension, "haproxy-config extension not found");
  return extension;
}

function contributedSettingKeys() {
  const properties = getExtension().packageJSON?.contributes?.configuration?.properties ?? {};
  return new Set(Object.keys(properties));
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureExtensionReady() {
  const extension = getExtension();
  if (!extension.isActive) {
    await extension.activate();
  }
}

async function updateSettingIfPresent(key, value, waitMs = 800) {
  const fullKey = `haproxy.${key}`;
  if (!contributedSettingKeys().has(fullKey)) {
    return false;
  }

  const config = vscode.workspace.getConfiguration("haproxy");
  await config.update(key, value, vscode.ConfigurationTarget.Global);
  await wait(waitMs);
  return true;
}

async function configureExtension() {
  await updateSettingIfPresent("diagnostics.enabled", true);
  await updateSettingIfPresent("diagnostics.maxLines", 26000);
  await updateSettingIfPresent("format.enabled", true);
  await updateSettingIfPresent("version", versionSetting, 2200);
}

async function openFixture(relativePath) {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  const uri = vscode.Uri.file(fixturePath(relativePath));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  return doc;
}

async function waitForDiagnostics(uri, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let stablePasses = 0;
  let lastCount = -1;
  let lastDiagnostics = [];

  while (Date.now() < deadline) {
    const diagnostics = vscode.languages
      .getDiagnostics(uri)
      .filter((diag) => diag.source === "haproxy");

    if (diagnostics.length === lastCount) {
      stablePasses += 1;
      if (stablePasses >= 6) {
        return diagnostics;
      }
    } else {
      stablePasses = 0;
      lastCount = diagnostics.length;
      lastDiagnostics = diagnostics;
    }

    await wait(100);
  }

  return lastDiagnostics;
}

async function completionCount(uri, position) {
  const list = await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    uri,
    position,
  );
  return list?.items?.length ?? 0;
}

async function hoverCount(uri, position) {
  const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", uri, position);
  return hovers?.length ?? 0;
}

async function definitionCount(uri, position) {
  const defs = await vscode.commands.executeCommand(
    "vscode.executeDefinitionProvider",
    uri,
    position,
  );
  if (!defs) {
    return 0;
  }
  return Array.isArray(defs) ? defs.length : 1;
}

async function referenceCount(uri, position) {
  const refs = await vscode.commands.executeCommand(
    "vscode.executeReferenceProvider",
    uri,
    position,
    true,
  );
  return refs?.length ?? 0;
}

async function symbolCount(uri) {
  const symbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri);
  return symbols?.length ?? 0;
}

async function formatEditCount(uri) {
  const edits = await vscode.commands.executeCommand("vscode.executeFormatDocumentProvider", uri);
  return edits?.length ?? 0;
}

suite("Tag Bench", function () {
  this.timeout(180000);

  /** @type {Array<object>} */
  const results = [];

  suiteSetup(async () => {
    await ensureExtensionReady();
    await configureExtension();
  });

  suiteTeardown(() => {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          extensionVersion: getExtension().packageJSON?.version ?? "unknown",
          benchmarks: results,
        },
        null,
        2,
      ) + "\n",
    );
  });

  test("run stable feature probes", async () => {
    const sampleDoc = await openFixture(path.join("integration", "fixtures", "sample.cfg"));
    const largeDoc = await openFixture(path.join("bench", "fixtures", "large-valid.cfg"));

    const sampleLines = sampleDoc.getText().split(/\r?\n/);
    const largeLines = largeDoc.getText().split(/\r?\n/);

    const balanceLine = sampleLines.findIndex((line) => line.trim().startsWith("balance "));
    const backendRefLine = sampleLines.findIndex((line) => line.includes("default_backend api"));

    assert.ok(balanceLine >= 0, "sample.cfg balance line not found");
    assert.ok(backendRefLine >= 0, "sample.cfg backend reference line not found");

    results.push(
      await safeMeasure(
        "completion.sample",
        async () => {
          const count = await completionCount(sampleDoc.uri, new vscode.Position(0, 0));
          assert.ok(count > 0, "completion returned no items");
        },
        { iterations: 12 },
      ),
    );

    results.push(
      await safeMeasure(
        "hover.balance",
        async () => {
          const count = await hoverCount(sampleDoc.uri, new vscode.Position(balanceLine, 6));
          assert.ok(count > 0, "hover returned no items");
        },
        { iterations: 10 },
      ),
    );

    results.push(
      await safeMeasure(
        "diagnostics.sample",
        async () => {
          await openFixture(path.join("integration", "fixtures", "wrong-section.cfg"));
          const diagnostics = await waitForDiagnostics(vscode.window.activeTextEditor.document.uri);
          assert.ok(diagnostics.length > 0, "no diagnostics produced");
        },
        { warmup: 0, iterations: 4 },
      ),
    );

    results.push(
      await safeMeasure(
        "format.messy",
        async () => {
          const messyDoc = await openFixture(
            path.join("integration", "fixtures", "messy-format.cfg"),
          );
          const editor = await vscode.window.showTextDocument(messyDoc, { preview: false });
          const messyBefore = messyDoc.getText();
          const edits = await formatEditCount(messyDoc.uri);
          assert.ok(edits > 0, "format provider returned no edits");
          await vscode.commands.executeCommand("editor.action.formatDocument");
          const after = editor.document.getText();
          assert.notStrictEqual(after, messyBefore, "format did not change document");
        },
        { iterations: 6 },
      ),
    );

    results.push(
      await safeMeasure(
        "symbols.large",
        async () => {
          const count = await symbolCount(largeDoc.uri);
          assert.ok(count > 0, "document symbols returned no items");
        },
        { iterations: 8 },
      ),
    );

    results.push(
      await safeMeasure(
        "definition.backend_ref",
        async () => {
          const count = await definitionCount(
            sampleDoc.uri,
            new vscode.Position(backendRefLine, sampleLines[backendRefLine].indexOf("api")),
          );
          assert.ok(count > 0, "definition returned no locations");
        },
        { iterations: 8 },
      ),
    );

    results.push(
      await safeMeasure(
        "references.backend_ref",
        async () => {
          const count = await referenceCount(
            sampleDoc.uri,
            new vscode.Position(backendRefLine, sampleLines[backendRefLine].indexOf("api")),
          );
          assert.ok(count > 0, "references returned no locations");
        },
        { iterations: 8 },
      ),
    );
  });
});
