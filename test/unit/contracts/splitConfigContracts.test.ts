import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { computeDiagnostics } from "../../../src/diagnostics";
import { findWorkspaceDefinitions } from "../../../src/symbolIndex";
import { assertNoErrorDiagnostics } from "../../helpers/configContracts";
import { createDocument } from "../../helpers/document";
import { diagnosticOptions, schemas } from "../../helpers/diagnostics";
import {
  buildWorkspace,
  defaultWorkspaceSymbolSettings,
  expectWorkspaceIndex,
  setupWorkspaceSymbolIndexTests,
  workspaceFolder,
} from "../workspaceSymbolIndex/helpers";
import { setMockWorkspaceFile, setMockWorkspaceFolders } from "../../helpers/vscode";

const splitConfigRoot = join(
  __dirname,
  "..",
  "..",
  "integration",
  "fixtures",
  "haproxy-tests",
  "haproxy.d",
);

function listSplitConfigFiles(): string[] {
  const files: string[] = [];
  function collect(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(full);
      } else if (entry.name.endsWith(".cfg")) {
        files.push(full);
      }
    }
  }
  collect(splitConfigRoot);
  return files.sort();
}

describe("split-config workspace contracts", () => {
  setupWorkspaceSymbolIndexTests();

  it("loads haproxy-tests split configs into workspace index", async () => {
    const files = listSplitConfigFiles();
    expect(files.length).toBeGreaterThanOrEqual(4);

    for (const filePath of files) {
      const uri = `file:///${filePath.replace(/\\/g, "/")}`;
      const content = readFileSync(filePath, "utf-8");
      setMockWorkspaceFile(uri, content);
    }

    setMockWorkspaceFolders([workspaceFolder(`file:///${splitConfigRoot.replace(/\\/g, "/")}`)]);

    const index = expectWorkspaceIndex(
      await buildWorkspace(
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        ["**/*.cfg"],
        defaultWorkspaceSymbolSettings(),
      ),
    );
    expect(index.documents.size).toBeGreaterThanOrEqual(4);
  });

  it.each(
    listSplitConfigFiles().map(
      (filePath) => [filePath.split(/[/\\]/).slice(-2).join("/"), filePath] as const,
    ),
  )("%s has no error diagnostics with workspace missing-reference checks", (_label, filePath) => {
    const content = readFileSync(filePath, "utf-8");
    const uri = `file:///${filePath.replace(/\\/g, "/")}`;
    const doc = createDocument(content, uri);
    const diagnostics = computeDiagnostics(doc, schemas["3.2"], {
      ...diagnosticOptions("3.2"),
      missingReferences: true,
      unusedSymbols: false,
    });
    expect(() => assertNoErrorDiagnostics(diagnostics, uri)).not.toThrow();
  });

  it("resolves cross-file backend reference from FE_WWW.cfg to BE_WWW.cfg", async () => {
    const frontendPath = join(splitConfigRoot, "frontends", "FE_WWW.cfg");
    const backendPath = join(splitConfigRoot, "backends", "BE_WWW.cfg");
    const frontendUri = `file:///repo/haproxy.d/frontends/FE_WWW.cfg`;
    const backendUri = `file:///repo/haproxy.d/backends/BE_WWW.cfg`;

    setMockWorkspaceFile(frontendUri, readFileSync(frontendPath, "utf-8"));
    setMockWorkspaceFile(backendUri, readFileSync(backendPath, "utf-8"));
    setMockWorkspaceFolders([workspaceFolder("file:///repo")]);

    const workspaceIndex = expectWorkspaceIndex(
      await buildWorkspace(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, [
        "**/haproxy.d/**/*.cfg",
        "**/haproxy.d/*.cfg",
        "**/*.cfg",
      ]),
    );

    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "be_www", null)).toHaveLength(
      1,
    );
  });

  it("keeps individual split files valid in isolation when references are disabled", () => {
    for (const filePath of listSplitConfigFiles()) {
      const content = readFileSync(filePath, "utf-8");
      const uri = `file:///${filePath.replace(/\\/g, "/")}`;
      const doc = createDocument(content, uri);
      const diagnostics = computeDiagnostics(doc, schemas["3.2"], {
        ...diagnosticOptions("3.2"),
        missingReferences: false,
        unusedSymbols: false,
      });
      expect(() => assertNoErrorDiagnostics(diagnostics, uri)).not.toThrow();
    }
  });
});
