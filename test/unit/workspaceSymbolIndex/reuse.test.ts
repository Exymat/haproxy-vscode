import {
  fingerprintText,
  findWorkspaceDefinitions,
  getWorkspaceSymbolIndex,
  scheduleWorkspaceSymbolIndexRebuild,
} from "../../../src/symbolIndex";
import {
  mockTextDocuments,
  setMockWorkspaceFile,
  setMockWorkspaceFileStat,
  setMockWorkspaceReadFailure,
  workspace,
} from "../../helpers/vscode";
import { createDocument } from "../../helpers/document";

import {
  buildWorkspace,
  defaultWorkspaceSymbolSettings,
  expectWorkspaceDocumentSymbols,
  expectWorkspaceIndex,
  schema,
  setupWorkspaceSymbolIndexTests,
} from "./helpers";

describe("workspace symbol index reuse and resilience", () => {
  setupWorkspaceSymbolIndexTests();

  it("reuses unchanged disk entries when stat metadata is unchanged", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    setMockWorkspaceFile("file:///b.cfg", "backend b");

    const workspaceIndex = expectWorkspaceIndex(await buildWorkspace());
    const firstA = expectWorkspaceDocumentSymbols(workspaceIndex, "file:///a.cfg");
    const firstB = expectWorkspaceDocumentSymbols(workspaceIndex, "file:///b.cfg");

    await buildWorkspace();
    const secondIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(expectWorkspaceDocumentSymbols(secondIndex, "file:///a.cfg")).toBe(firstA);
    expect(expectWorkspaceDocumentSymbols(secondIndex, "file:///b.cfg")).toBe(firstB);
  });

  it("rebuilds disk entries when stat metadata changes", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    await buildWorkspace();
    const first = expectWorkspaceDocumentSymbols(
      expectWorkspaceIndex(getWorkspaceSymbolIndex()),
      "file:///a.cfg",
    );

    setMockWorkspaceFileStat("file:///a.cfg", Date.now() + 1000, "backend a".length + 5);
    await buildWorkspace();
    const second = expectWorkspaceDocumentSymbols(
      expectWorkspaceIndex(getWorkspaceSymbolIndex()),
      "file:///a.cfg",
    );
    expect(second).not.toBe(first);
  });

  it("reuses open document entries when content fingerprint is unchanged", async () => {
    setMockWorkspaceFile("file:///api.cfg", "backend api");
    const doc = createDocument("backend api", "file:///api.cfg");
    mockTextDocuments.push(doc as never);

    const workspaceIndex = expectWorkspaceIndex(await buildWorkspace());
    const first = expectWorkspaceDocumentSymbols(workspaceIndex, "file:///api.cfg");

    Object.defineProperty(doc, "version", { value: doc.version + 1 });
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "incremental",
      document: doc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const second = expectWorkspaceDocumentSymbols(
      expectWorkspaceIndex(getWorkspaceSymbolIndex()),
      "file:///api.cfg",
    );
    expect(second.index).toBe(first.index);
    expect(second.parsed).toBe(first.parsed);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.version).toBe(2);
  });

  it("updates a single open document incrementally without rediscovering files", async () => {
    setMockWorkspaceFile("file:///backends/other.cfg", "backend other");
    setMockWorkspaceFile("file:///frontends/web.cfg", "frontend web\n    use_backend api");
    const doc = createDocument("frontend web\n    use_backend api", "file:///frontends/web.cfg");
    mockTextDocuments.push(doc as never);

    await buildWorkspace();
    const findFilesSpy = vi.spyOn(workspace, "findFiles");
    findFilesSpy.mockClear();

    doc.getText = () => "frontend web\n    use_backend renamed";
    Object.defineProperty(doc, "version", { value: doc.version + 1 });

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "incremental",
      document: doc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(findFilesSpy).not.toHaveBeenCalled();
    const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "other", null)).toHaveLength(
      1,
    );
  });

  it("reuses cached discovery on content rebuilds", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    await buildWorkspace();
    const findFilesSpy = vi.spyOn(workspace, "findFiles");
    findFilesSpy.mockClear();

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "content",
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(findFilesSpy).not.toHaveBeenCalled();
  });

  it("evicts unreadable disk files instead of keeping cached entries", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    setMockWorkspaceFile("file:///b.cfg", "backend b");
    await buildWorkspace();

    setMockWorkspaceFileStat("file:///b.cfg", Date.now() + 1000, 999);
    setMockWorkspaceReadFailure("file:///b.cfg", true);
    await buildWorkspace();

    const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "a", null)).toHaveLength(1);
    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "b", null)).toHaveLength(0);
    expect(workspaceIndex.documents.has("file:///b.cfg")).toBe(false);
  });

  it("uses a stable sha256 content fingerprint", () => {
    const text = "backend api\n    server s1 127.0.0.1:80";
    expect(fingerprintText(text)).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintText(text)).toBe(fingerprintText(text));
    expect(fingerprintText(`${text}\n`)).not.toBe(fingerprintText(text));
  });
});
