import * as assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  assertDiagnosticCounts as assertCounts,
  countDiagnosticsByCode,
  formatDiagnostics,
} from "../../helpers/diagnosticCounts";
import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";

const EXTENSION_ID = "Exymat.haproxy-config";
const DEFAULT_FIXTURES_DIR = path.resolve(__dirname, "../../../../test/integration/fixtures");
const FIXTURES_DIR = process.env.HAPROXY_INTEGRATION_FIXTURES_DIR
  ? path.resolve(process.env.HAPROXY_INTEGRATION_FIXTURES_DIR)
  : DEFAULT_FIXTURES_DIR;
const DEFAULT_HAPROXY_VERSION = "3.2";

function languageIdForVersion(version: string): string {
  return `haproxy-${version}`;
}

function isHaproxyLanguageId(languageId: string): boolean {
  return languageId === "haproxy" || /^haproxy-\d+\.\d+$/.test(languageId);
}

function getConfiguredHaproxyVersion(): string {
  const raw = vscode.workspace.getConfiguration("haproxy").get<string>("version");
  if (raw && /^(\d+\.\d+)$/.test(raw)) {
    return raw;
  }
  return DEFAULT_HAPROXY_VERSION;
}

export async function waitForHaproxyGrammarLanguage(
  document: vscode.TextDocument,
  version = getConfiguredHaproxyVersion(),
): Promise<vscode.TextDocument> {
  const expectedLanguageId = languageIdForVersion(version);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current =
      vscode.workspace.textDocuments.find(
        (openDoc) => openDoc.uri.toString() === document.uri.toString(),
      ) ?? document;
    if (current.languageId === expectedLanguageId) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const current =
    vscode.workspace.textDocuments.find(
      (openDoc) => openDoc.uri.toString() === document.uri.toString(),
    ) ?? document;
  assert.strictEqual(
    current.languageId,
    expectedLanguageId,
    `Expected grammar language ${expectedLanguageId}`,
  );
  return current;
}

export function assertHaproxyLanguage(
  document: vscode.TextDocument,
  version = getConfiguredHaproxyVersion(),
): void {
  assert.ok(
    isHaproxyLanguageId(document.languageId),
    `Document must use a HAProxy language id, got ${document.languageId}`,
  );
  assert.strictEqual(
    document.languageId,
    languageIdForVersion(version),
    `Document must use grammar language for HAProxy ${version}`,
  );
}

let extensionReady: Promise<void> | undefined;

export function fixturePath(relativePath: string): string {
  return path.join(FIXTURES_DIR, relativePath);
}

export async function ensureExtensionReady(): Promise<void> {
  if (!extensionReady) {
    extensionReady = (async () => {
      const ext = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(ext, `Extension ${EXTENSION_ID} not found`);
      await ext.activate();

      const uri = vscode.Uri.file(fixturePath("sample.cfg"));
      let doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      doc = await waitForHaproxyGrammarLanguage(doc);
      assertHaproxyLanguage(doc);

      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const items = await vscode.commands.executeCommand<vscode.CompletionList>(
          "vscode.executeCompletionItemProvider",
          doc.uri,
          new vscode.Position(0, 0),
        );
        if (items && items.items.length > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await waitForDiagnosticsReady(500);
    })();
  }
  await extensionReady;
}

async function expectedLineCount(uri: vscode.Uri): Promise<number> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8").split(/\r?\n/).length;
}

export async function openFixture(relativePath: string): Promise<vscode.TextDocument> {
  await ensureExtensionReady();
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");

  const uri = vscode.Uri.file(fixturePath(relativePath));
  const linesOnDisk = await expectedLineCount(uri);

  const deadline = Date.now() + 5000;
  let doc = await vscode.workspace.openTextDocument(uri);
  while (doc.lineCount < linesOnDisk && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    doc = await vscode.workspace.openTextDocument(uri);
  }

  assert.ok(
    doc.lineCount >= linesOnDisk,
    `${relativePath}: expected at least ${linesOnDisk} lines, got ${doc.lineCount}`,
  );
  await vscode.window.showTextDocument(doc);
  doc = await waitForHaproxyGrammarLanguage(doc);
  assertHaproxyLanguage(doc);
  await waitForDiagnosticsReady();
  return doc;
}

export async function openHaproxyDocument(content: string): Promise<vscode.TextDocument> {
  await ensureExtensionReady();
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  let doc = await vscode.workspace.openTextDocument({ language: "haproxy", content });
  await vscode.window.showTextDocument(doc);
  doc = await waitForHaproxyGrammarLanguage(doc);
  assertHaproxyLanguage(doc);
  await waitForDiagnosticsReady();
  return doc;
}

export async function openTempFixtureDocument(
  name: string,
  content: string,
): Promise<vscode.TextDocument> {
  await ensureExtensionReady();
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  const dir = path.join(os.tmpdir(), "haproxy-vscode-integration");
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
  const uri = vscode.Uri.file(path.join(dir, name));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
  let doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  doc = await waitForHaproxyGrammarLanguage(doc);
  assertHaproxyLanguage(doc);
  await waitForDiagnosticsReady();
  return doc;
}

export async function waitForDiagnosticsReady(extraMs = 300): Promise<void> {
  const debounceMs = vscode.workspace
    .getConfiguration("haproxy")
    .get<number>("diagnostics.debounceMs", 500);
  await new Promise((resolve) => setTimeout(resolve, debounceMs + extraMs));
}

export async function completionLabelsAt(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<string[]> {
  const items = await completionItemsAt(uri, position);
  return items.map((item) => (typeof item.label === "string" ? item.label : item.label.label));
}

export async function completionItemsAt(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<vscode.CompletionItem[]> {
  const items = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    uri,
    position,
  );
  return items?.items ?? [];
}

export async function hoverTextAt(uri: vscode.Uri, position: vscode.Position): Promise<string> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    uri,
    position,
  );
  return (hovers ?? [])
    .flatMap((hover) => hover.contents)
    .map((content) =>
      typeof content === "string" ? content : "value" in content ? content.value : "",
    )
    .join("");
}

function normalizeLocations(
  value: vscode.Location | vscode.Location[] | vscode.LocationLink[] | undefined | null,
): vscode.Location[] {
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) =>
    "targetUri" in entry
      ? new vscode.Location(entry.targetUri, entry.targetSelectionRange ?? entry.targetRange)
      : entry,
  );
}

export async function definitionLocationsAt(
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<vscode.Location[]> {
  const value = await vscode.commands.executeCommand<
    vscode.Location | vscode.Location[] | vscode.LocationLink[]
  >("vscode.executeDefinitionProvider", uri, position);
  return normalizeLocations(value);
}

export async function referenceLocationsAt(
  uri: vscode.Uri,
  position: vscode.Position,
  includeDeclaration: boolean,
): Promise<vscode.Location[]> {
  const value = await vscode.commands.executeCommand<vscode.Location[]>(
    "vscode.executeReferenceProvider",
    uri,
    position,
    includeDeclaration,
  );
  return normalizeLocations(value);
}

export async function renameEditsAt(
  uri: vscode.Uri,
  position: vscode.Position,
  newName: string,
): Promise<vscode.WorkspaceEdit | undefined> {
  return vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    "vscode.executeDocumentRenameProvider",
    uri,
    position,
    newName,
  );
}

export async function replaceDocumentContent(
  document: vscode.TextDocument,
  content: string,
): Promise<vscode.TextDocument> {
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange, content);
  const applied = await vscode.workspace.applyEdit(edit);
  assert.strictEqual(applied, true, "Workspace edit failed");
  await waitForDiagnosticsReady();
  const updated = vscode.workspace.textDocuments.find(
    (openDoc) => openDoc.uri.toString() === document.uri.toString(),
  );
  assert.ok(updated, `Updated document not found for ${document.uri.toString()}`);
  return updated;
}

export async function closeActiveEditor(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  await new Promise((resolve) => setTimeout(resolve, 200));
}

export function haproxyDiagnostics(diags: vscode.Diagnostic[]): vscode.Diagnostic[] {
  return diags.filter((d) => d.source === "haproxy");
}

export async function waitForSchemaDiagnostics(
  uri: vscode.Uri,
  minCount = 1,
  timeoutMs = 15000,
): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + timeoutMs;
  let stablePasses = 0;
  let lastCount = -1;
  let lastDiagnostics: vscode.Diagnostic[] = [];

  while (Date.now() < deadline) {
    const diagnostics = haproxyDiagnostics(vscode.languages.getDiagnostics(uri));
    if (diagnostics.length === lastCount && diagnostics.length >= minCount) {
      stablePasses += 1;
      if (stablePasses >= 10) {
        return diagnostics;
      }
    } else {
      stablePasses = 0;
      lastCount = diagnostics.length;
      lastDiagnostics = diagnostics;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return lastDiagnostics;
}

export async function updateHaproxySetting(
  key: string,
  value: unknown,
  waitMs?: number,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("haproxy");
  await config.update(key, value, vscode.ConfigurationTarget.Global);
  await config.update(key, value, vscode.ConfigurationTarget.Workspace);
  if (key === "version") {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const folderConfig = vscode.workspace.getConfiguration("haproxy", folder.uri);
      await folderConfig.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
    }
  }
  const debounceMs = config.get<number>("diagnostics.debounceMs", 500);
  await new Promise((resolve) => setTimeout(resolve, waitMs ?? debounceMs + 400));
}

export async function updateHaproxySettingForFolder(
  folderUri: vscode.Uri,
  key: string,
  value: unknown,
  waitMs?: number,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("haproxy", folderUri);
  await config.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
  const debounceMs = config.get<number>("diagnostics.debounceMs", 500);
  await new Promise((resolve) => setTimeout(resolve, waitMs ?? debounceMs + 400));
}

export async function openDocumentInFolder(
  folderPath: string,
  relativePath: string,
  content: string,
  version: string,
): Promise<vscode.TextDocument> {
  await ensureExtensionReady();
  const filePath = path.join(folderPath, relativePath);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)));
  const uri = vscode.Uri.file(filePath);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
  let doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  doc = await waitForHaproxyGrammarLanguage(doc, version);
  assertHaproxyLanguage(doc, version);
  await waitForDiagnosticsReady();
  return doc;
}

export async function clearHaproxySetting(key: string, waitMs?: number): Promise<void> {
  const config = vscode.workspace.getConfiguration("haproxy");
  await config.update(key, undefined, vscode.ConfigurationTarget.Global);
  await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
  const debounceMs = config.get<number>("diagnostics.debounceMs", 500);
  await new Promise((resolve) => setTimeout(resolve, waitMs ?? debounceMs + 400));
}

export async function ensureHaproxyVersion(version: string): Promise<void> {
  const current = vscode.workspace.getConfiguration("haproxy").get<string>("version");
  if (current === version) {
    await updateHaproxySetting("version", "3.0", 800);
  }
  await updateHaproxySetting("version", version, 2500);
}

export function filterDiagnostics(
  diags: vscode.Diagnostic[],
  severity: vscode.DiagnosticSeverity,
): vscode.Diagnostic[] {
  return diags.filter((d) => d.severity === severity);
}

export function assertDiagnosticCounts(
  diags: vscode.Diagnostic[],
  expected: Record<string, number>,
  label: string,
): void {
  assertCounts(diags, expected, label);
}

export function diagnosticCount(diags: vscode.Diagnostic[], code: string): number {
  return countDiagnosticsByCode(diags).get(code) ?? 0;
}

export function assertDiagnosticMinimumCounts(
  diags: vscode.Diagnostic[],
  expected: Record<string, number>,
  label: string,
): void {
  const counts = countDiagnosticsByCode(diags);
  for (const [code, count] of Object.entries(expected)) {
    const actual = counts.get(code) ?? 0;
    if (actual < count) {
      throw new Error(
        `${label}: expected at least ${count} '${code}' diagnostic(s), got ${actual}\n${formatDiagnostics(diags)}`,
      );
    }
  }
}

export function positionOf(
  document: vscode.TextDocument,
  needle: string,
  occurrence = 0,
): vscode.Position {
  const text = document.getText();
  let index = -1;
  let searchFrom = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    index = text.indexOf(needle, searchFrom);
    assert.ok(index >= 0, `Expected to find '${needle}' occurrence ${occurrence}`);
    searchFrom = index + needle.length;
  }
  return document.positionAt(index);
}

export async function formatDocumentContent(content: string): Promise<string> {
  const doc = await openHaproxyDocument(content);
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    "vscode.executeFormatDocumentProvider",
    doc.uri,
  );

  const workEdit = new vscode.WorkspaceEdit();
  if (edits && edits.length > 0) {
    for (const edit of edits) {
      workEdit.replace(doc.uri, edit.range, edit.newText);
    }
    await vscode.workspace.applyEdit(workEdit);
    const updated = vscode.workspace.textDocuments.find(
      (openDoc) => openDoc.uri.toString() === doc.uri.toString(),
    );
    if (updated) {
      return updated.getText();
    }
  }

  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const before = editor.document.getText();
  await vscode.commands.executeCommand("editor.action.formatDocument");
  const after = editor.document.getText();
  assert.notStrictEqual(after, before, "Format Document made no changes");
  return after;
}

export async function resetHaproxySettings(): Promise<void> {
  await ensureExtensionReady();
  const config = vscode.workspace.getConfiguration("haproxy");
  await config.update(
    "diagnostics.unusedSymbols.sections",
    undefined,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "diagnostics.unusedSymbols.sections",
    undefined,
    vscode.ConfigurationTarget.Workspace,
  );
  const defaults: Array<[string, unknown]> = [
    ["version", "3.2"],
    ["format.enabled", true],
    ["format.indent", "spaces-4"],
    ["format.insertBlankLineBetweenSections", true],
    ["diagnostics.enabled", true],
    ["diagnostics.deprecatedWarnings", true],
    ["diagnostics.maxLines", 4000],
    ["diagnostics.unusedSymbols", true],
    ["diagnostics.missingReferences", true],
    ["workspaceSymbols.enabled", true],
    ["workspaceSymbols.include", ["**/*.cfg"]],
    [
      "workspaceSymbols.exclude",
      ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/out/**", "**/vendor/**"],
    ],
    ["workspaceSymbols.maxFiles", 0],
    ["workspaceSymbols.maxTotalLines", 0],
    ["workspaceSymbols.maxFileBytes", 0],
    ["workspaceSymbols.maxTotalBytes", 0],
    ["workspaceSymbols.maxLineBytes", 0],
    ["workspaceSymbols.debounceMs", 750],
  ];
  for (const [key, value] of defaults) {
    await config.update(key, value, vscode.ConfigurationTarget.Global);
    await config.update(key, value, vscode.ConfigurationTarget.Workspace);
  }
  await waitForDiagnosticsReady(500);
}

export const NAVIGATION_CONFIG = [
  "defaults profile_default",
  "    mode http",
  "frontend web from profile_default",
  "    bind :80",
  "    acl is_api path_beg /api",
  "    use_backend api if is_api",
  "backend api",
  "    server web1 127.0.0.1:8080 check",
  "    use-server web1 if is_api",
].join("\n");

export async function waitForDefinitionTarget(
  uri: vscode.Uri,
  position: vscode.Position,
  expectedUriSuffix: string,
): Promise<vscode.Location[]> {
  const deadline = Date.now() + 10000;
  let locations: vscode.Location[] = [];
  while (Date.now() < deadline) {
    locations = await definitionLocationsAt(uri, position);
    if (locations.some((location) => location.uri.toString().endsWith(expectedUriSuffix))) {
      return locations;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return locations;
}

export async function waitForReferenceUris(
  uri: vscode.Uri,
  position: vscode.Position,
  expectedUriSuffixes: string[],
): Promise<vscode.Location[]> {
  const deadline = Date.now() + 10000;
  let locations: vscode.Location[] = [];
  while (Date.now() < deadline) {
    locations = await referenceLocationsAt(uri, position, true);
    const actual = new Set(locations.map((location) => location.uri.toString()));
    if (
      expectedUriSuffixes.every((suffix) =>
        [...actual].some((actualUri) => actualUri.endsWith(suffix)),
      )
    ) {
      return locations;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return locations;
}

export async function waitForHoverTextContaining(
  uri: vscode.Uri,
  position: vscode.Position,
  expectedText: string,
): Promise<string> {
  const deadline = Date.now() + 10000;
  let text = "";
  while (Date.now() < deadline) {
    text = await hoverTextAt(uri, position);
    if (text.includes(expectedText)) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return text;
}

export function pathSuffix(uri: vscode.Uri): string {
  const path = uri.path.replace(/\\/g, "/");
  const marker = "/workspace-symbols/";
  const markerIndex = path.indexOf(marker);
  return markerIndex >= 0 ? path.slice(markerIndex) : path;
}

export async function waitForNoDiagnosticCode(
  uri: vscode.Uri,
  code: string,
): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + 10000;
  let diagnostics: vscode.Diagnostic[] = [];
  while (Date.now() < deadline) {
    diagnostics = await waitForSchemaDiagnostics(uri, 0, 2000);
    if (!diagnostics.some((diag) => formatDiagnosticCode(diag.code) === code)) {
      return diagnostics;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return diagnostics;
}

export async function waitForDiagnosticCode(
  uri: vscode.Uri,
  code: string,
): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + 10000;
  let diagnostics: vscode.Diagnostic[] = [];
  while (Date.now() < deadline) {
    diagnostics = await waitForSchemaDiagnostics(uri, 0, 2000);
    if (diagnostics.some((diag) => formatDiagnosticCode(diag.code) === code)) {
      return diagnostics;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return diagnostics;
}
