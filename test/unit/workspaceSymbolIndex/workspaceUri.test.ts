import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceUriKey } from "../../../src/symbolIndex";

describe("workspaceUriKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves non-file URIs", () => {
    expect(
      workspaceUriKey({
        scheme: "untitled",
        fsPath: undefined,
        toString: () => "untitled:HAProxy.cfg",
      } as never),
    ).toBe("untitled:HAProxy.cfg");
  });

  it("detects Windows drive paths even off Windows", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    expect(
      workspaceUriKey({
        scheme: "file",
        fsPath: "C:\\Projects\\test.cfg",
        toString: () => "file:///c:/projects/test.cfg",
      } as never),
    ).toBe("file:///c:/projects/test.cfg");
  });

  it("preserves non-Windows file URI casing off Windows", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    expect(
      workspaceUriKey({
        scheme: "file",
        fsPath: "/Repo/HAProxy.cfg",
        toString: () => "file:///Repo/HAProxy.cfg",
      } as never),
    ).toBe("file:///Repo/HAProxy.cfg");
  });

  it("normalizes encoded Windows file URIs", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    expect(
      workspaceUriKey({
        scheme: "file",
        fsPath: "",
        toString: () => "file:///c%3a/projects/test.cfg",
      } as never),
    ).toBe("file:///c%3a/projects/test.cfg");
  });
});
