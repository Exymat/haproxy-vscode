import * as vscode from "vscode";

import { prepareRename, provideRenameEdits } from "../../../src/navigation/rename";
import {
  clearWorkspaceSymbolIndex,
  scheduleWorkspaceSymbolIndexRebuild,
} from "../../../src/symbolIndex";
import { mockTextDocuments, resetMockVscode, setMockWorkspaceFile } from "../../helpers/vscode";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";
import { defaultWorkspaceSymbolSettings } from "../workspaceSymbolIndex/helpers";

const schema = loadSchema("3.4");

function resetRenameTestState(): void {
  resetMockVscode();
  mockTextDocuments.length = 0;
  clearWorkspaceSymbolIndex();
}

function pos(line: number, character: number): vscode.Position {
  return { line, character } as vscode.Position;
}

function editRanges(
  edit: vscode.WorkspaceEdit,
): Array<{ line: number; start: number; end: number; text: string }> {
  return (
    (edit as unknown as { edits: Array<{ uri?: unknown; range: vscode.Range; newText: string }> })
      .edits ?? []
  )
    .map(({ range, newText }) => ({
      line: range.start.line,
      start: range.start.character,
      end: range.end.character,
      text: newText,
    }))
    .sort((a, b) => a.line - b.line || a.start - b.start);
}

function editUris(edit: vscode.WorkspaceEdit): string[] {
  return [
    ...new Set(
      (
        (edit as unknown as { edits: Array<{ uri?: { fsPath?: string; toString: () => string } }> })
          .edits ?? []
      ).map((entry) => entry.uri?.fsPath ?? String(entry.uri)),
    ),
  ].sort();
}

describe("rename provider", () => {
  it("renames backend definitions and use_backend/default_backend references", () => {
    const doc = createDocument(
      "backend api\nfrontend web\n    use_backend api\n    default_backend api",
    );
    const edit = provideRenameEdits(doc, pos(2, "    use_backend ".length), "api_v2", schema, 4000);
    expect(edit).not.toBeNull();
    expect(editRanges(edit as vscode.WorkspaceEdit)).toEqual([
      { line: 0, start: "backend ".length, end: "backend api".length, text: "api_v2" },
      {
        line: 2,
        start: "    use_backend ".length,
        end: "    use_backend api".length,
        text: "api_v2",
      },
      {
        line: 3,
        start: "    default_backend ".length,
        end: "    default_backend api".length,
        text: "api_v2",
      },
    ]);
  });

  it("renames negated ACL references without replacing the bang", () => {
    const doc = createDocument(
      "frontend web\n    acl is_api path_beg /api\n    http-request deny if !is_api",
    );
    const col = "    http-request deny if !is_api".indexOf("is_api");
    const prepared = prepareRename(doc, pos(2, col), schema, 4000);
    expect(prepared?.range.start.character).toBe(col);

    const edit = provideRenameEdits(doc, pos(2, col), "is_admin", schema, 4000);
    expect(editRanges(edit as vscode.WorkspaceEdit)).toEqual([
      { line: 1, start: "    acl ".length, end: "    acl is_api".length, text: "is_admin" },
      { line: 2, start: col, end: col + "is_api".length, text: "is_admin" },
    ]);
  });

  it("renames only the selected filter in split filter-sequence references", () => {
    const doc = createDocument(
      "frontend web\n    filter comp-req\n    filter comp-res\n    filter-sequence request comp-req,comp-res",
    );
    const col = "    filter-sequence request comp-req,comp-res".indexOf("comp-res");
    const edit = provideRenameEdits(doc, pos(3, col), "comp-alt", schema, 4000);
    expect(editRanges(edit as vscode.WorkspaceEdit)).toEqual([
      { line: 2, start: "    filter ".length, end: "    filter comp-res".length, text: "comp-alt" },
      { line: 3, start: col, end: col + "comp-res".length, text: "comp-alt" },
    ]);
  });

  it("rejects invalid names and same-scope collisions", () => {
    const doc = createDocument("frontend web\n    acl one path /one\n    acl two path /two");
    const col = "    acl one".indexOf("one");
    expect(() => provideRenameEdits(doc, pos(1, col), "", schema, 4000)).toThrow("cannot be empty");
    expect(() => provideRenameEdits(doc, pos(1, col), "bad/name", schema, 4000)).toThrow(
      "cannot contain",
    );
    expect(() => provideRenameEdits(doc, pos(1, col), "two", schema, 4000)).toThrow(
      "already exists",
    );
  });

  it("renames environment variable definitions and references with env-name validation", () => {
    const doc = createDocument(
      [
        "global",
        "    setenv FOO bar",
        '    log "${FOO-default}:514" local0',
        "    http-request deny if { env(FOO) -m found }",
      ].join("\n"),
    );
    const edit = provideRenameEdits(doc, pos(2, '    log "${'.length), "FOO_V2", schema, 4000);
    expect(editRanges(edit as vscode.WorkspaceEdit)).toEqual([
      { line: 1, start: "    setenv ".length, end: "    setenv FOO".length, text: "FOO_V2" },
      { line: 2, start: '    log "${'.length, end: '    log "${FOO'.length, text: "FOO_V2" },
      {
        line: 3,
        start: "    http-request deny if { env(".length,
        end: "    http-request deny if { env(FOO".length,
        text: "FOO_V2",
      },
    ]);

    expect(() =>
      provideRenameEdits(doc, pos(1, "    setenv ".length), "bad-name", schema, 4000),
    ).toThrow("environment variable names");
    expect(() => provideRenameEdits(doc, pos(1, "    setenv ".length), "", schema, 4000)).toThrow(
      "environment variable names cannot be empty",
    );
  });

  it("returns null when no renameable symbol can be resolved", () => {
    const doc = createDocument("frontend web\n    use_backend api");
    expect(prepareRename(doc, pos(1, 0), schema, 4000)).toBeNull();
    expect(provideRenameEdits(doc, pos(1, 0), "api_v2", schema, 4000)).toBeNull();
    expect(prepareRename(doc, pos(1, "    use_backend ".length), schema, 1)).toBeNull();
  });

  it("renames backend definitions and references across workspace files", async () => {
    vi.useFakeTimers();
    resetRenameTestState();
    setMockWorkspaceFile("file:///backends/api.cfg", "backend api\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///frontends/web.cfg", "frontend web\n    use_backend api");
    const frontend = createDocument(
      "frontend web\n    use_backend api",
      "file:///frontends/web.cfg",
    );
    mockTextDocuments.push(frontend as never);

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const edit = provideRenameEdits(
      frontend,
      pos(1, "    use_backend ".length),
      "api_v2",
      schema,
      4000,
    );
    expect(editRanges(edit as vscode.WorkspaceEdit)).toHaveLength(2);
    expect(editUris(edit as vscode.WorkspaceEdit)).toEqual([
      "file:///backends/api.cfg",
      "file:///frontends/web.cfg",
    ]);
    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
  });

  it("rejects workspace-wide duplicate names during cross-file rename", async () => {
    vi.useFakeTimers();
    resetRenameTestState();
    setMockWorkspaceFile("file:///backends/api.cfg", "backend api");
    setMockWorkspaceFile("file:///backends/other.cfg", "backend other");
    setMockWorkspaceFile("file:///frontends/web.cfg", "frontend web\n    use_backend api");
    const frontend = createDocument(
      "frontend web\n    use_backend api",
      "file:///frontends/web.cfg",
    );
    mockTextDocuments.push(frontend as never);

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(() =>
      provideRenameEdits(frontend, pos(1, "    use_backend ".length), "other", schema, 4000),
    ).toThrow("already exists");
    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
  });

  it("rejects workspace-wide rename when multiple definitions share the old name", async () => {
    vi.useFakeTimers();
    resetRenameTestState();
    setMockWorkspaceFile("file:///prod/backend.cfg", "backend api");
    setMockWorkspaceFile("file:///staging/backend.cfg", "backend api");
    setMockWorkspaceFile("file:///prod/frontend.cfg", "frontend web\n    use_backend api");
    const frontend = createDocument(
      "frontend web\n    use_backend api",
      "file:///prod/frontend.cfg",
    );
    mockTextDocuments.push(frontend as never);

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(() =>
      provideRenameEdits(frontend, pos(1, "    use_backend ".length), "prod_api", schema, 4000),
    ).toThrow(/definitions exist/);
    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
  });

  it("allows workspace-wide ACL rename when duplicate names are in different scopes", async () => {
    vi.useFakeTimers();
    resetRenameTestState();
    setMockWorkspaceFile(
      "file:///frontends/web.cfg",
      "frontend web\n    acl is_api path_beg /api\n    http-request deny if !is_api",
    );
    setMockWorkspaceFile(
      "file:///frontends/admin.cfg",
      "frontend admin\n    acl is_api path_beg /admin",
    );
    const web = createDocument(
      "frontend web\n    acl is_api path_beg /api\n    http-request deny if !is_api",
      "file:///frontends/web.cfg",
    );
    mockTextDocuments.push(web as never);

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const col = "    http-request deny if !is_api".indexOf("is_api");
    const edit = provideRenameEdits(web, pos(2, col), "is_public", schema, 4000);
    expect(edit).not.toBeNull();
    expect(editUris(edit as vscode.WorkspaceEdit)).toEqual(["file:///frontends/web.cfg"]);
    expect(editRanges(edit as vscode.WorkspaceEdit)).toHaveLength(2);
    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
  });

  it("does not rename prod and staging backends that share the same name", async () => {
    vi.useFakeTimers();
    resetRenameTestState();
    setMockWorkspaceFile("file:///prod/frontend.cfg", "frontend web\n    use_backend api");
    setMockWorkspaceFile("file:///prod/backend.cfg", "backend api");
    setMockWorkspaceFile("file:///staging/frontend.cfg", "frontend web\n    use_backend api");
    setMockWorkspaceFile("file:///staging/backend.cfg", "backend api");
    const prodFrontend = createDocument(
      "frontend web\n    use_backend api",
      "file:///prod/frontend.cfg",
    );
    mockTextDocuments.push(prodFrontend as never);

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(() =>
      provideRenameEdits(prodFrontend, pos(1, "    use_backend ".length), "prod_api", schema, 4000),
    ).toThrow(/definitions exist/);
    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
  });
});
