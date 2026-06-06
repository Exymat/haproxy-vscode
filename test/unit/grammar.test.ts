import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  activeGrammarPath,
  grammarPathForVersion,
  promptReloadIfGrammarChanged,
  syncActiveGrammar,
  syncActiveGrammarAsync,
} from "../../src/grammar";
import { commands, resetVscodeMock, setMockInfoMessageResult } from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";

describe("grammar paths", () => {
  it("builds version-specific and active grammar paths", () => {
    const root = "/ext";
    expect(grammarPathForVersion(root, "3.2")).toBe(
      path.join(root, "syntaxes", "haproxy-3.2.tmLanguage.json"),
    );
    expect(activeGrammarPath(root)).toBe(
      path.join(root, "syntaxes", "haproxy-active.tmLanguage.json"),
    );
  });
});

describe("syncActiveGrammar", () => {
  let tempDir: string;

  beforeEach(() => {
    resetVscodeMock();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haproxy-grammar-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function contextWithVersion(version: string) {
    const syntaxDir = path.join(tempDir, "syntaxes");
    fs.mkdirSync(syntaxDir, { recursive: true });
    const src = path.join(syntaxDir, `haproxy-${version}.tmLanguage.json`);
    fs.writeFileSync(src, JSON.stringify({ version, scopeName: "source.haproxy" }));
    return {
      extensionPath: tempDir,
      subscriptions: [],
    };
  }

  it("returns false when source grammar is missing", () => {
    const context = { extensionPath: tempDir, subscriptions: [] };
    expect(syncActiveGrammar(context as never, "3.2")).toBe(false);
  });

  it("returns true when grammar file is new", () => {
    const context = contextWithVersion("3.2");
    expect(syncActiveGrammar(context as never, "3.2")).toBe(true);
    expect(fs.existsSync(activeGrammarPath(tempDir))).toBe(true);
  });

  it("returns false when grammar is unchanged", () => {
    const context = contextWithVersion("3.2");
    expect(syncActiveGrammar(context as never, "3.2")).toBe(true);
    expect(syncActiveGrammar(context as never, "3.2")).toBe(false);
  });

  it("returns true when grammar content changes", () => {
    const context = contextWithVersion("3.2");
    syncActiveGrammar(context as never, "3.2");

    const src = grammarPathForVersion(tempDir, "3.4");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, JSON.stringify({ version: "3.4", scopeName: "source.haproxy" }));

    expect(syncActiveGrammar(context as never, "3.4")).toBe(true);
  });

  it("syncs real extension grammars without error", () => {
    const context = mockExtensionContext();
    const changed = syncActiveGrammar(context as never, "3.2");
    expect(typeof changed).toBe("boolean");
  });
});

describe("syncActiveGrammarAsync", () => {
  let tempDir: string;

  beforeEach(() => {
    resetVscodeMock();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haproxy-grammar-async-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function contextWithVersion(version: string) {
    const syntaxDir = path.join(tempDir, "syntaxes");
    fs.mkdirSync(syntaxDir, { recursive: true });
    const src = path.join(syntaxDir, `haproxy-${version}.tmLanguage.json`);
    fs.writeFileSync(src, JSON.stringify({ version, scopeName: "source.haproxy" }));
    return {
      extensionPath: tempDir,
      subscriptions: [],
    };
  }

  it("returns false when source grammar is missing", async () => {
    const context = { extensionPath: tempDir, subscriptions: [] };
    await expect(syncActiveGrammarAsync(context as never, "3.2")).resolves.toBe(false);
  });

  it("returns true when grammar file is new", async () => {
    const context = contextWithVersion("3.2");
    await expect(syncActiveGrammarAsync(context as never, "3.2")).resolves.toBe(true);
    expect(fs.existsSync(activeGrammarPath(tempDir))).toBe(true);
  });

  it("returns false when grammar is unchanged", async () => {
    const context = contextWithVersion("3.2");
    await expect(syncActiveGrammarAsync(context as never, "3.2")).resolves.toBe(true);
    await expect(syncActiveGrammarAsync(context as never, "3.2")).resolves.toBe(false);
  });
});

describe("promptReloadIfGrammarChanged", () => {
  beforeEach(() => {
    resetVscodeMock();
    vi.mocked(commands.executeCommand).mockClear();
  });

  it("does nothing when grammar did not change", async () => {
    await promptReloadIfGrammarChanged(false);
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("does not reload when user dismisses the prompt", async () => {
    setMockInfoMessageResult("Dismiss");
    await promptReloadIfGrammarChanged(true);
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("reloads window when user chooses Reload", async () => {
    setMockInfoMessageResult("Reload Window");
    await promptReloadIfGrammarChanged(true);
    expect(commands.executeCommand).toHaveBeenCalledWith("workbench.action.reloadWindow");
  });
});
