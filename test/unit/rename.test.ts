import * as vscode from "vscode";

import { prepareRename, provideRenameEdits } from "../../src/rename";
import { createDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";

const schema = loadSchema("3.4");

function pos(line: number, character: number): vscode.Position {
  return { line, character } as vscode.Position;
}

function editRanges(
  edit: vscode.WorkspaceEdit,
): Array<{ line: number; start: number; end: number; text: string }> {
  return (
    (edit as unknown as { edits: Array<{ range: vscode.Range; newText: string }> }).edits ?? []
  )
    .map(({ range, newText }) => ({
      line: range.start.line,
      start: range.start.character,
      end: range.end.character,
      text: newText,
    }))
    .sort((a, b) => a.line - b.line || a.start - b.start);
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

  it("returns null when no renameable symbol can be resolved", () => {
    const doc = createDocument("frontend web\n    use_backend api");
    expect(prepareRename(doc, pos(1, 0), schema, 4000)).toBeNull();
    expect(provideRenameEdits(doc, pos(1, 0), "api_v2", schema, 4000)).toBeNull();
    expect(prepareRename(doc, pos(1, "    use_backend ".length), schema, 1)).toBeNull();
  });
});
