import * as assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import {
  addWorkspaceFolder,
  assertHaproxyLanguage,
  completionLabelsAt,
  diagnosticCount,
  haproxyDiagnostics,
  hoverTextAt,
  openDocumentInFolder,
  referenceLocationsAt,
  resetHaproxySettings,
  updateHaproxySetting,
  updateHaproxySettingForFolder,
  waitForDiagnosticCode,
  waitForHaproxyGrammarLanguage,
  waitForNoDiagnosticCode,
  waitForReferenceUris,
  waitForSchemaDiagnostics,
} from "./helpers";

const NAMED_DEFAULTS_CONFIG = [
  "defaults",
  "    acl is_api path_beg /api",
  "    http-request deny if TRUE",
  "    maxconn 1000",
  "",
  "defaults profile_a",
  "    acl named_api path_beg /api",
  "    http-request deny if TRUE",
].join("\n");

const HATERM_CONFIG = "frontend x\n    mode haterm\n";

const WORKSPACE_REF_CONFIG_A = [
  "frontend web",
  "    use_backend api",
  "backend api",
  "    server web1 127.0.0.1:8080 check",
].join("\n");

const WORKSPACE_REF_CONFIG_B = [
  "frontend app",
  "    use_backend svc",
  "backend svc",
  "    server app1 127.0.0.1:9090 check",
].join("\n");

suite("Folder-scoped HAProxy version", () => {
  let folderA = "";
  let folderB = "";
  let folderARef: vscode.WorkspaceFolder;
  let folderBRef: vscode.WorkspaceFolder;

  suiteSetup(async function () {
    this.timeout(120000);
    await resetHaproxySettings();
    await updateHaproxySetting("diagnostics.enabled", true);
    await updateHaproxySetting("workspaceSymbols.enabled", true);
    await updateHaproxySetting("workspaceSymbols.debounceMs", 300);

    const root = path.join(os.tmpdir(), "haproxy-vscode-multiroot", String(Date.now()));
    folderA = path.join(root, "folder-a");
    folderB = path.join(root, "folder-b");
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(folderA));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(folderB));

    folderARef = await addWorkspaceFolder(folderA, "folder-a");
    folderBRef = await addWorkspaceFolder(folderB, "folder-b");

    await updateHaproxySettingForFolder(folderARef.uri, "version", "2.6", 1500);
    await updateHaproxySettingForFolder(folderBRef.uri, "version", "3.4", 1500);
  });

  suiteTeardown(async () => {
    await resetHaproxySettings();
  });

  test("uses each workspace folder configured version for grammar, providers, and diagnostics", async function () {
    this.timeout(90000);

    const docA = await openDocumentInFolder(
      folderA,
      "named-defaults.cfg",
      NAMED_DEFAULTS_CONFIG,
      "2.6",
    );
    const docB = await openDocumentInFolder(
      folderB,
      "named-defaults.cfg",
      NAMED_DEFAULTS_CONFIG,
      "3.4",
    );

    assertHaproxyLanguage(docA, "2.6");
    assertHaproxyLanguage(docB, "3.4");

    const diagnosticsA = await waitForNoDiagnosticCode(docA.uri, "named-defaults-required");
    assert.strictEqual(
      diagnosticCount(diagnosticsA, "named-defaults-required"),
      0,
      `Folder A on 2.6 should not require named defaults: ${diagnosticsA.map((d) => d.message).join(", ")}`,
    );

    const diagnosticsB = await waitForDiagnosticCode(docB.uri, "named-defaults-required");
    assert.ok(
      diagnosticCount(diagnosticsB, "named-defaults-required") >= 2,
      `Folder B on 3.4 should require named defaults: ${diagnosticsB.map((d) => d.message).join(", ")}`,
    );

    const labelsA = await completionLabelsAt(docA.uri, new vscode.Position(0, "defaults".length));
    assert.ok(labelsA.length > 0, "Expected completion items in folder A");

    const labelsB = await completionLabelsAt(docB.uri, new vscode.Position(0, "defaults".length));
    assert.ok(labelsB.length > 0, "Expected completion items in folder B");

    const hoverA = await hoverTextAt(docA.uri, new vscode.Position(0, 2));
    const hoverB = await hoverTextAt(docB.uri, new vscode.Position(0, 2));
    assert.ok(hoverA.length > 0, "Expected hover text in folder A");
    assert.ok(hoverB.length > 0, "Expected hover text in folder B");
  });

  test("keeps diagnostics isolated when one folder version changes", async function () {
    this.timeout(90000);

    const docA = await openDocumentInFolder(folderA, "mode-haterm.cfg", HATERM_CONFIG, "2.6");
    const docB = await openDocumentInFolder(folderB, "mode-haterm.cfg", HATERM_CONFIG, "3.4");

    const beforeA = await waitForSchemaDiagnostics(docA.uri, 0);
    assert.ok(
      beforeA.some((diag) => formatDiagnosticCode(diag.code) === "unknown-value"),
      "Expected mode haterm to be invalid on 2.6",
    );

    const beforeB = await waitForNoDiagnosticCode(docB.uri, "unknown-value");
    assert.strictEqual(
      diagnosticCount(beforeB, "unknown-value"),
      0,
      "Expected mode haterm to be valid on 3.4 before folder A changes",
    );

    await updateHaproxySettingForFolder(folderARef.uri, "version", "3.4", 2500);
    await waitForHaproxyGrammarLanguage(docA, "3.4");
    assertHaproxyLanguage(docA, "3.4");

    const afterA = await waitForNoDiagnosticCode(docA.uri, "unknown-value");
    assert.strictEqual(
      diagnosticCount(afterA, "unknown-value"),
      0,
      "Folder A should accept mode haterm after switching to 3.4",
    );

    const afterB = haproxyDiagnostics(vscode.languages.getDiagnostics(docB.uri));
    assert.strictEqual(
      diagnosticCount(afterB, "unknown-value"),
      0,
      "Folder B diagnostics should remain valid after folder A version changes",
    );

    await updateHaproxySettingForFolder(folderARef.uri, "version", "2.6", 2500);
  });

  test("builds workspace references from each folder configured schema", async function () {
    this.timeout(90000);

    const frontendA = await openDocumentInFolder(
      folderA,
      "refs/frontend.cfg",
      WORKSPACE_REF_CONFIG_A.split("\n").slice(0, 2).join("\n"),
      "2.6",
    );
    const _backendA = await openDocumentInFolder(
      folderA,
      "refs/backend.cfg",
      WORKSPACE_REF_CONFIG_A.split("\n").slice(2).join("\n"),
      "2.6",
    );
    const frontendB = await openDocumentInFolder(
      folderB,
      "refs/frontend.cfg",
      WORKSPACE_REF_CONFIG_B.split("\n").slice(0, 2).join("\n"),
      "3.4",
    );
    const backendB = await openDocumentInFolder(
      folderB,
      "refs/backend.cfg",
      WORKSPACE_REF_CONFIG_B.split("\n").slice(2).join("\n"),
      "3.4",
    );

    const useBackendPos = new vscode.Position(1, "    use_backend ".length + 1);
    const refsA = await waitForReferenceUris(frontendA.uri, useBackendPos, ["refs/backend.cfg"]);
    assert.ok(
      refsA.every((location) => location.uri.toString().includes("folder-a")),
      "Folder A references should stay inside folder A",
    );
    assert.ok(
      refsA.some((location) => location.uri.toString().endsWith("refs/backend.cfg")),
      "Expected cross-file backend reference in folder A",
    );

    const refsB = await waitForReferenceUris(frontendB.uri, useBackendPos, ["refs/backend.cfg"]);
    assert.ok(
      refsB.every((location) => location.uri.toString().includes("folder-b")),
      "Folder B references should stay inside folder B",
    );
    assert.ok(
      refsB.some((location) => location.uri.toString().endsWith("refs/backend.cfg")),
      "Expected cross-file backend reference in folder B",
    );

    assert.notStrictEqual(
      refsA[0]?.uri.toString(),
      refsB[0]?.uri.toString(),
      "Reference targets should differ across folders",
    );

    const staleBRefs = await referenceLocationsAt(
      backendB.uri,
      new vscode.Position(0, "backend ".length + 1),
      true,
    );
    assert.ok(
      staleBRefs.every((location) => location.uri.toString().includes("folder-b")),
      "Folder B backend references should not point into folder A",
    );
  });
});
