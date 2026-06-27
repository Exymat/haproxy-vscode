import * as vscode from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDiagnosticScheduler } from "../../src/diagnosticScheduler";
import { resetVscodeMock } from "../__mocks__/vscode";
import { getExtensionSettings } from "../../src/settings";

describe("diagnosticScheduler", () => {
  beforeEach(() => {
    resetVscodeMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports bundle load failures through onBundleError", async () => {
    const setDiagnostics = vi.fn();
    const diagnostics = {
      set: setDiagnostics,
      delete: vi.fn(),
    } as unknown as vscode.DiagnosticCollection;
    const onBundleError = vi.fn();
    const ensureBundle = vi.fn().mockRejectedValue(new Error("scheduler load failed"));
    const scheduler = createDiagnosticScheduler(
      diagnostics,
      getExtensionSettings,
      ensureBundle,
      onBundleError,
    );

    const document = {
      uri: { toString: () => "file:///test.cfg" },
      languageId: "haproxy",
      lineCount: 1,
    } as vscode.TextDocument;

    scheduler.schedule(document);
    await vi.advanceTimersByTimeAsync(getExtensionSettings().diagnosticsDebounceMs);

    expect(onBundleError).toHaveBeenCalledWith("scheduler load failed");
    expect(setDiagnostics).toHaveBeenCalledWith(document.uri, []);
  });
});
