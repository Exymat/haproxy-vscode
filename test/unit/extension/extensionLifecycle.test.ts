import { describe, expect, it, vi } from "vitest";

import { registerExtensionLifecycle } from "../../../src/extension/extensionLifecycle";
import * as grammar from "../../../src/extension/grammar";
import { getExtensionSettings } from "../../../src/extension/settings";
import {
  resetMockVscode,
  setMockConfigForUri,
  setMockWorkspaceFolders,
  triggerMockFolderConfigurationChange,
} from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";
import { loadSchemaBundle } from "../../helpers/schema";
import { defaultWorkspaceSymbolSettings, workspaceFolder } from "../workspaceSymbolIndex/helpers";

const bundle = { version: "3.4", ...loadSchemaBundle("3.4") };

describe("extension lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockVscode();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("schedules folder-scoped workspace rebuilds after folder version changes", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///folder-a")]);
    setMockConfigForUri({ toString: () => "file:///folder-a" }, "haproxy", "version", "3.4");
    vi.spyOn(grammar, "syncAllOpenDocumentGrammarLanguages").mockResolvedValue();
    const scheduleForUri = vi.fn((_uri: unknown, _scope: string) => Promise.resolve());
    const diagnostics = {
      scheduler: {
        schedule: vi.fn(),
        runNow: vi.fn(),
        disposeDocument: vi.fn(),
        clearPending: vi.fn(),
      },
      refreshAllDocuments: vi.fn(),
      refreshDocumentsInWorkspaceFolders: vi.fn(),
      dispose: vi.fn(),
    };

    registerExtensionLifecycle({
      context: mockExtensionContext() as never,
      extensionVersion: "test",
      getSettings: getExtensionSettings,
      refreshSettings: vi.fn(),
      diagnostics,
      bundle: {
        ensureBundleResilient: vi.fn(() => Promise.resolve(bundle)),
        safeEnsureBundle: vi.fn(() => Promise.resolve(bundle)),
        resolveWorkspaceSchema: vi.fn(() => Promise.resolve(bundle.schema)),
        invalidate: vi.fn(),
        reportBundleError: vi.fn(),
        resetErrorReporting: vi.fn(),
        dispose: vi.fn(),
      },
      workspaceSymbols: {
        settings: () => defaultWorkspaceSymbolSettings(),
        scheduleForUri,
        schedule: vi.fn(() => Promise.resolve()),
        scheduleRebuildWithReadyBundle: vi.fn(),
        configureWatchers: vi.fn(),
        handleWorkspaceFoldersChanged: vi.fn(),
      } as never,
    });

    triggerMockFolderConfigurationChange("haproxy.version", {
      folderUris: ["file:///folder-a"],
    });
    await vi.runAllTimersAsync();

    const firstCall = scheduleForUri.mock.calls[0];
    expect(firstCall?.[1]).toBe("full");
    const uri = firstCall?.[0] as { toString: () => string } | undefined;
    expect(uri?.toString()).toBe("file:///folder-a");
  });
});
