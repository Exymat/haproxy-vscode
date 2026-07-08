import { getExtensionSettings, getFormatOptions, onSettingsChanged } from "../../src/settings";
import {
  resetVscodeMock,
  setMockConfig,
  triggerMockConfigurationChange,
} from "../__mocks__/vscode";

describe("settings", () => {
  beforeEach(() => {
    resetVscodeMock();
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
      workspaceSymbolsMaxFiles: 1000,
      workspaceSymbolsMaxTotalLines: 100000,
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

  it("clamps workspace symbol limits to minimums", () => {
    setMockConfig("haproxy", "workspaceSymbols.maxFiles", 0);
    setMockConfig("haproxy", "workspaceSymbols.maxTotalLines", 10);
    setMockConfig("haproxy", "workspaceSymbols.debounceMs", 50);
    const settings = getExtensionSettings();
    expect(settings.workspaceSymbolsMaxFiles).toBe(1);
    expect(settings.workspaceSymbolsMaxTotalLines).toBe(100);
    expect(settings.workspaceSymbolsDebounceMs).toBe(100);
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
