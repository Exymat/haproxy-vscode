import { describe, expect, it } from "vitest";

import {
  clearWorkspaceSymbolIndex,
  getWorkspaceSymbolIndex,
  isWorkspaceRebuildPending,
  resolveWorkspaceRebuildScopeOnOpen,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
} from "../../../src/symbolIndex";
import { setMockWorkspaceFile } from "../../helpers/vscode";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";
import {
  defaultWorkspaceSymbolSettings,
  setupWorkspaceSymbolIndexTests,
} from "../workspaceSymbolIndex/helpers";

const schema = loadSchema("3.4");

describe("workspaceRebuild scheduling", () => {
  setupWorkspaceSymbolIndexTests();

  it("marks rebuild pending until timers flush", () => {
    clearWorkspaceSymbolIndex();
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    expect(isWorkspaceRebuildPending()).toBe(true);
  });

  it("resolves open scope to none for non-haproxy documents", () => {
    const document = createDocument("plain text", "file:///a.txt");
    Object.defineProperty(document, "languageId", { value: "plaintext" });
    expect(resolveWorkspaceRebuildScopeOnOpen(document)).toBe("none");
  });

  it("resolves open scope to full when workspace index is missing", () => {
    const document = createDocument("backend api", "file:///a.cfg");
    Object.defineProperty(document, "languageId", { value: "haproxy-3.4" });
    expect(resolveWorkspaceRebuildScopeOnOpen(document)).toBe("full");
  });

  it("clears pending state after rebuild runs", async () => {
    clearWorkspaceSymbolIndex();
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(isWorkspaceRebuildPending()).toBe(false);
  });

  it("clears the active workspace index when workspace symbols are disabled", async () => {
    const listener = vi.fn();
    setMockWorkspaceFile("file:///a.cfg", "backend api\n    server s1 127.0.0.1:80");
    setWorkspaceSymbolIndexChangeListener(listener);

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(getWorkspaceSymbolIndex()).not.toBeNull();

    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      defaultWorkspaceSymbolSettings({ enabled: false }),
      4000,
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(getWorkspaceSymbolIndex()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "full" }));
  });
});
