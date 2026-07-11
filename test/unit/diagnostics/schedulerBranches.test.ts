import * as vscode from "vscode";
import { describe, expect, it, vi } from "vitest";

import { createDiagnosticScheduler } from "../../../src/diagnostics/diagnosticScheduler";
import { getExtensionSettings } from "../../../src/extension/settings";

describe("diagnosticScheduler branch behavior", () => {
  it("reports non-Error bundle failures as strings", async () => {
    vi.useFakeTimers();
    try {
      const setDiagnostics = vi.fn();
      const diagnostics = {
        set: setDiagnostics,
        delete: vi.fn(),
      } as unknown as vscode.DiagnosticCollection;
      const onBundleError = vi.fn();
      const scheduler = createDiagnosticScheduler(
        diagnostics,
        getExtensionSettings,
        vi.fn().mockRejectedValue("scheduler string failure"),
        onBundleError,
      );

      const document = {
        uri: { toString: () => "file:///branch-scheduler.cfg" },
        languageId: "haproxy",
        lineCount: 1,
        version: 1,
      } as vscode.TextDocument;

      scheduler.schedule(document);
      await vi.advanceTimersByTimeAsync(getExtensionSettings().diagnosticsDebounceMs);

      expect(onBundleError).toHaveBeenCalledWith("scheduler string failure");
      expect(setDiagnostics).toHaveBeenCalledWith(document.uri, []);
    } finally {
      vi.useRealTimers();
    }
  });
});
