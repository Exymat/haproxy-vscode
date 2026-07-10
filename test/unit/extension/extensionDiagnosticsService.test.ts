import { describe, expect, it, vi } from "vitest";

import { createExtensionDiagnosticsService } from "../../../src/extensionDiagnosticsService";
import { getExtensionSettings } from "../../../src/settings";
import {
  getLastDiagnosticCollection,
  mockTextDocuments,
  resetMockVscode,
  setMockConfig,
  setMockWorkspaceFolders,
} from "../../helpers/vscode";
import { createDocument } from "../../helpers/document";
import { mockExtensionContext } from "../../helpers/extensionContext";
import { loadSchemaBundle } from "../../helpers/schema";
import { workspaceFolder } from "../workspaceSymbolIndex/helpers";

const bundle = loadSchemaBundle("3.4");

describe("extension diagnostics service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockVscode();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refreshes diagnostics only for documents in affected workspace folders", async () => {
    setMockConfig("haproxy", "diagnostics.debounceMs", 100);
    setMockWorkspaceFolders([workspaceFolder("file:///repo"), workspaceFolder("file:///other")]);
    const repoDoc = createDocument("backend repo", "file:///repo/haproxy.cfg");
    const otherDoc = createDocument("backend other", "file:///other/haproxy.cfg");
    const plainDoc = createDocument("hello", "file:///repo/readme.txt");
    Object.defineProperty(plainDoc, "languageId", { value: "plaintext" });
    mockTextDocuments.push(repoDoc as never, otherDoc as never, plainDoc as never);

    const service = createExtensionDiagnosticsService(mockExtensionContext() as never, {
      getSettings: getExtensionSettings,
      ensureBundle: () => Promise.resolve({ version: "3.4", ...bundle }),
      onBundleError: vi.fn(),
    });

    service.refreshDocumentsInWorkspaceFolders(["file:///repo"]);
    await vi.advanceTimersByTimeAsync(100);

    const setUris =
      getLastDiagnosticCollection()?.set.mock.calls.map((call) => {
        const uri = call[0] as { toString: () => string };
        return uri.toString();
      }) ?? [];
    expect(setUris).toContain("file:///repo/haproxy.cfg");
    expect(setUris).not.toContain("file:///other/haproxy.cfg");
    expect(setUris).not.toContain("file:///repo/readme.txt");
  });
});
