import { getExtensionSettings, getFormatOptions, onSettingsChanged } from "../../../src/settings";
import {
  resetMockVscode,
  setMockConfig,
  triggerMockConfigurationChange,
} from "../../helpers/vscode";

describe("settings", () => {
  beforeEach(() => {
    resetMockVscode();
  });

  it("reads extension settings with defaults", () => {
    expect(getExtensionSettings()).toEqual({
      diagnosticsEnabled: true,
      diagnosticsDebounceMs: 500,
      maxDiagnosticsLines: 4000,
      formatEnabled: true,
      formatIndent: "spaces-4",
      formatInsertBlankLineBetweenSections: true,
      deprecatedWarnings: true,
      unusedSymbols: true,
      missingReferences: true,
      workspaceSymbolsEnabled: true,
      workspaceSymbolsInclude: ["**/*.cfg"],
      workspaceSymbolsExclude: [
        "**/.git/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/out/**",
        "**/vendor/**",
      ],
      workspaceSymbolsMaxFiles: Number.POSITIVE_INFINITY,
      workspaceSymbolsMaxTotalLines: Number.POSITIVE_INFINITY,
      workspaceSymbolsMaxFileBytes: Number.POSITIVE_INFINITY,
      workspaceSymbolsMaxTotalBytes: Number.POSITIVE_INFINITY,
      workspaceSymbolsMaxLineBytes: Number.POSITIVE_INFINITY,
      workspaceSymbolsDebounceMs: 750,
    });
  });

  it("clamps debounce and max lines to minimums", () => {
    setMockConfig("haproxy", "diagnostics.debounceMs", 50);
    setMockConfig("haproxy", "diagnostics.maxLines", 10);
    const settings = getExtensionSettings();
    expect(settings.diagnosticsDebounceMs).toBe(100);
    expect(settings.maxDiagnosticsLines).toBe(100);
  });

  it("clamps debounce settings to maximums", () => {
    setMockConfig("haproxy", "diagnostics.debounceMs", 999999);
    setMockConfig("haproxy", "workspaceSymbols.debounceMs", 600000);
    const settings = getExtensionSettings();
    expect(settings.diagnosticsDebounceMs).toBe(5000);
    expect(settings.workspaceSymbolsDebounceMs).toBe(10000);
  });

  it("clamps workspace symbol limits to minimums", () => {
    setMockConfig("haproxy", "workspaceSymbols.maxFiles", 0.5);
    setMockConfig("haproxy", "workspaceSymbols.maxTotalLines", 10);
    setMockConfig("haproxy", "workspaceSymbols.maxFileBytes", 100);
    setMockConfig("haproxy", "workspaceSymbols.maxTotalBytes", 1000);
    setMockConfig("haproxy", "workspaceSymbols.maxLineBytes", 10);
    setMockConfig("haproxy", "workspaceSymbols.debounceMs", 50);
    const settings = getExtensionSettings();
    expect(settings.workspaceSymbolsMaxFiles).toBe(1);
    expect(settings.workspaceSymbolsMaxTotalLines).toBe(100);
    expect(settings.workspaceSymbolsMaxFileBytes).toBe(10240);
    expect(settings.workspaceSymbolsMaxTotalBytes).toBe(102400);
    expect(settings.workspaceSymbolsMaxLineBytes).toBe(256);
    expect(settings.workspaceSymbolsDebounceMs).toBe(100);
  });

  it("treats zero workspace symbol size limits as unlimited", () => {
    setMockConfig("haproxy", "workspaceSymbols.maxFiles", 0);
    setMockConfig("haproxy", "workspaceSymbols.maxTotalLines", 0);
    setMockConfig("haproxy", "workspaceSymbols.maxFileBytes", 0);
    setMockConfig("haproxy", "workspaceSymbols.maxTotalBytes", 0);
    setMockConfig("haproxy", "workspaceSymbols.maxLineBytes", 0);
    const settings = getExtensionSettings();
    expect(settings.workspaceSymbolsMaxFiles).toBe(Number.POSITIVE_INFINITY);
    expect(settings.workspaceSymbolsMaxTotalLines).toBe(Number.POSITIVE_INFINITY);
    expect(settings.workspaceSymbolsMaxFileBytes).toBe(Number.POSITIVE_INFINITY);
    expect(settings.workspaceSymbolsMaxTotalBytes).toBe(Number.POSITIVE_INFINITY);
    expect(settings.workspaceSymbolsMaxLineBytes).toBe(Number.POSITIVE_INFINITY);
  });

  it("uses format.indent when valid", () => {
    setMockConfig("haproxy", "format.indent", "spaces-2");
    expect(getExtensionSettings().formatIndent).toBe("spaces-2");
    setMockConfig("haproxy", "format.indent", "tab");
    expect(getExtensionSettings().formatIndent).toBe("tab");
  });

  it("falls back to legacy indentStyle and indentSize when format.indent is invalid", () => {
    setMockConfig("haproxy", "format.indent", "not-valid");
    setMockConfig("haproxy", "format.indentStyle", "tab");
    expect(getExtensionSettings().formatIndent).toBe("tab");

    setMockConfig("haproxy", "format.indent", "");
    setMockConfig("haproxy", "format.indentStyle", "spaces");
    setMockConfig("haproxy", "format.indentSize", 2);
    expect(getExtensionSettings().formatIndent).toBe("spaces-2");

    setMockConfig("haproxy", "format.indentSize", 4);
    expect(getExtensionSettings().formatIndent).toBe("spaces-4");
  });

  it("builds format options from settings", () => {
    setMockConfig("haproxy", "format.indent", "spaces-2");
    setMockConfig("haproxy", "format.insertBlankLineBetweenSections", false);
    expect(getFormatOptions()).toEqual({
      indentStyle: "spaces",
      indentSize: 2,
      insertBlankLineBetweenSections: false,
    });
  });

  it("notifies onSettingsChanged when haproxy config changes", () => {
    const listener = vi.fn();
    onSettingsChanged(listener);
    triggerMockConfigurationChange("haproxy");
    expect(listener).toHaveBeenCalledOnce();
    listener.mockClear();
    triggerMockConfigurationChange("editor");
    expect(listener).not.toHaveBeenCalled();
  });
});
