import * as vscode from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDiagnosticScheduler } from "../../../src/diagnostics/diagnosticScheduler";
import { resetMockVscode } from "../../helpers/vscode";
import { loadSchemaBundle } from "../../helpers/schema";
import { getExtensionSettings } from "../../../src/extension/settings";

const bundle = loadSchemaBundle("3.4");

describe("diagnosticScheduler", () => {
  beforeEach(() => {
    resetMockVscode();
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
    } as unknown as vscode.TextDocument;

    scheduler.schedule(document);
    await vi.advanceTimersByTimeAsync(getExtensionSettings().diagnosticsDebounceMs);

    expect(onBundleError).toHaveBeenCalledWith("scheduler load failed");
    expect(setDiagnostics).toHaveBeenCalledWith(document.uri, []);
  });

  it("runs diagnostics immediately through runNow", async () => {
    const setDiagnostics = vi.fn();
    const diagnostics = {
      set: setDiagnostics,
      delete: vi.fn(),
    } as unknown as vscode.DiagnosticCollection;
    const ensureBundle = vi.fn().mockResolvedValue({
      ...bundle,
      version: "3.4",
    });
    const scheduler = createDiagnosticScheduler(
      diagnostics,
      getExtensionSettings,
      ensureBundle,
      vi.fn(),
    );

    const document = {
      uri: { toString: () => "file:///test.cfg" },
      languageId: "haproxy",
      lineCount: 1,
      lineAt: () => ({ text: "global" }),
      getText: () => "global",
      version: 1,
    } as unknown as vscode.TextDocument;

    scheduler.runNow(document);
    await Promise.resolve();

    expect(setDiagnostics).toHaveBeenCalled();
  });

  it("skips runNow for non-haproxy documents", () => {
    const setDiagnostics = vi.fn();
    const deleteDiagnostics = vi.fn();
    const diagnostics = {
      set: setDiagnostics,
      delete: deleteDiagnostics,
    } as unknown as vscode.DiagnosticCollection;
    const scheduler = createDiagnosticScheduler(
      diagnostics,
      getExtensionSettings,
      vi.fn(),
      vi.fn(),
    );

    const document = {
      uri: { toString: () => "file:///test.cfg" },
      languageId: "plaintext",
      lineCount: 1,
    } as unknown as vscode.TextDocument;

    scheduler.runNow(document);
    expect(setDiagnostics).not.toHaveBeenCalled();
    expect(deleteDiagnostics).not.toHaveBeenCalled();
  });

  it("skips publishing diagnostics when document version changes during bundle load", async () => {
    const setDiagnostics = vi.fn();
    const diagnostics = {
      set: setDiagnostics,
      delete: vi.fn(),
    } as unknown as vscode.DiagnosticCollection;
    let resolveBundle = (_value: unknown): void => {
      throw new Error("bundle load not started");
    };
    const ensureBundle = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBundle = resolve;
        }),
    );
    const scheduler = createDiagnosticScheduler(
      diagnostics,
      getExtensionSettings,
      ensureBundle,
      vi.fn(),
    );

    let version = 1;
    const document = {
      uri: { toString: () => "file:///test.cfg" },
      languageId: "haproxy",
      lineCount: 1,
      lineAt: () => ({ text: "global" }),
      getText: () => "global",
      get version() {
        return version;
      },
    } as unknown as vscode.TextDocument;

    scheduler.runNow(document);
    await Promise.resolve();

    version = 2;
    resolveBundle({ ...bundle, version: "3.4" });
    await Promise.resolve();

    expect(setDiagnostics).not.toHaveBeenCalled();
  });

  it("skips bundle error handling when document version changes during failed bundle load", async () => {
    const setDiagnostics = vi.fn();
    const diagnostics = {
      set: setDiagnostics,
      delete: vi.fn(),
    } as unknown as vscode.DiagnosticCollection;
    const onBundleError = vi.fn();
    let rejectBundle = (_error: unknown): void => {
      throw new Error("bundle load not started");
    };
    const ensureBundle = vi.fn().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectBundle = reject;
        }),
    );
    const scheduler = createDiagnosticScheduler(
      diagnostics,
      getExtensionSettings,
      ensureBundle,
      onBundleError,
    );

    let version = 1;
    const document = {
      uri: { toString: () => "file:///test.cfg" },
      languageId: "haproxy",
      lineCount: 1,
      lineAt: () => ({ text: "global" }),
      getText: () => "global",
      get version() {
        return version;
      },
    } as unknown as vscode.TextDocument;

    scheduler.runNow(document);
    await Promise.resolve();

    version = 2;
    rejectBundle(new Error("scheduler load failed"));
    await Promise.resolve();

    expect(onBundleError).not.toHaveBeenCalled();
    expect(setDiagnostics).not.toHaveBeenCalled();
  });

  it("publishes diagnostics when document version is unchanged after bundle load", async () => {
    const setDiagnostics = vi.fn();
    const diagnostics = {
      set: setDiagnostics,
      delete: vi.fn(),
    } as unknown as vscode.DiagnosticCollection;
    let resolveBundle = (_value: unknown): void => {
      throw new Error("bundle load not started");
    };
    const ensureBundle = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBundle = resolve;
        }),
    );
    const scheduler = createDiagnosticScheduler(
      diagnostics,
      getExtensionSettings,
      ensureBundle,
      vi.fn(),
    );

    const document = {
      uri: { toString: () => "file:///test.cfg" },
      languageId: "haproxy",
      lineCount: 1,
      lineAt: () => ({ text: "global" }),
      getText: () => "global",
      version: 1,
    } as unknown as vscode.TextDocument;

    scheduler.runNow(document);
    await Promise.resolve();

    resolveBundle({ ...bundle, version: "3.4" });
    await Promise.resolve();

    expect(setDiagnostics).toHaveBeenCalledWith(document.uri, expect.any(Array));
  });

  it("skips runNow when diagnostics are disabled", () => {
    const setDiagnostics = vi.fn();
    const deleteDiagnostics = vi.fn();
    const diagnostics = {
      set: setDiagnostics,
      delete: deleteDiagnostics,
    } as unknown as vscode.DiagnosticCollection;
    const scheduler = createDiagnosticScheduler(
      diagnostics,
      () => ({ ...getExtensionSettings(), diagnosticsEnabled: false }),
      vi.fn(),
      vi.fn(),
    );

    const document = {
      uri: { toString: () => "file:///test.cfg" },
      languageId: "haproxy",
      lineCount: 1,
    } as unknown as vscode.TextDocument;

    scheduler.runNow(document);
    expect(deleteDiagnostics).toHaveBeenCalledWith(document.uri);
    expect(setDiagnostics).not.toHaveBeenCalled();
  });
});
