import { vi } from "vitest";

import { activate, deactivate } from "../../src/extension";
import { mockExtensionContext } from "./extensionContext";
import {
  resetVscodeMock,
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
  Uri,
} from "../__mocks__/vscode";

export * from "../__mocks__/vscode";

export function resetMockVscode(): void {
  resetVscodeMock();
}

export function mockWorkspaceFile(path: string, content: string) {
  setMockWorkspaceFile(path, content);
  return Uri.file(path);
}

export function mockWorkspaceFolder(uri: string, name = "workspace") {
  return { uri: Uri.parse(uri), name };
}

export function setMockWorkspace(uri: string, name = "workspace"): void {
  setMockWorkspaceFolders([mockWorkspaceFolder(uri, name)]);
}

export async function withFakeTimers<T>(run: () => T | Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

export function withActivatedExtension(context = mockExtensionContext()) {
  activate(context as never);
  return {
    context,
    deactivate,
  };
}
