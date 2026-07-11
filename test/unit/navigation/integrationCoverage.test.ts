import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Position } from "vscode";

import { provideDefinition, provideReferences } from "../../../src/navigation";
import { provideRenameEdits } from "../../../src/rename";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.2");
const fixturesDir = join(__dirname, "..", "..", "integration", "fixtures");

function pos(line: number, character: number) {
  return { line, character } as Position;
}

function positionOf(content: string, needle: string, occurrence = 0) {
  let index = -1;
  let searchFrom = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    index = content.indexOf(needle, searchFrom);
    expect(index).toBeGreaterThanOrEqual(0);
    searchFrom = index + needle.length;
  }
  const before = content.slice(0, index).split(/\r?\n/);
  return pos(before.length - 1, before[before.length - 1].length);
}

describe("integration-promoted navigation coverage", () => {
  it("resolves file-backed symbol graph references without launching VS Code", () => {
    const content = readFileSync(join(fixturesDir, "symbol-graph.cfg"), "utf-8");
    const doc = createDocument(content);

    const backendDefs = provideDefinition(doc, positionOf(content, "api if is_api"), schema, 4000);
    expect(Array.isArray(backendDefs)).toBe(true);
    expect(backendDefs as unknown[]).toHaveLength(1);

    const aclRefs = provideReferences(
      doc,
      positionOf(content, "is_api", 1),
      { includeDeclaration: true },
      schema,
      4000,
    );
    expect(aclRefs.map((location) => location.range.start.line).sort((a, b) => a - b)).toEqual([
      positionOf(content, "acl is_api").line,
      positionOf(content, "api if is_api").line,
    ]);
  });

  it("renames split filter-sequence references at source level", () => {
    const content = readFileSync(join(fixturesDir, "symbol-graph.cfg"), "utf-8");
    const doc = createDocument(content);
    const edit = provideRenameEdits(
      doc,
      positionOf(content, "comp-res", 1),
      "comp-alt",
      schema,
      4000,
    );
    expect(edit).not.toBeNull();
    const mockEdit = edit as unknown as { edits: Array<{ newText: string }> };
    expect(mockEdit.edits.map((entry) => entry.newText)).toEqual(["comp-alt", "comp-alt"]);
  });

  it("resolves environment variable definitions, references, and externals", () => {
    const content = [
      "global",
      "    setenv FOO bar",
      '    log "${FOO-default}:514" local0',
      "    http-request deny if { env(FOO) -m found }",
      '    user "$HAPROXY_USER"',
    ].join("\n");
    const doc = createDocument(content);

    const defs = provideDefinition(doc, pos(2, '    log "${'.length), schema, 4000);
    expect(Array.isArray(defs)).toBe(false);
    expect((defs as { range: { start: { line: number } } } | null)?.range.start.line).toBe(1);

    const refs = provideReferences(
      doc,
      pos(1, "    setenv ".length),
      { includeDeclaration: true },
      schema,
      4000,
    );
    expect(refs.map((location) => location.range.start.line)).toEqual([1, 2, 3]);

    expect(provideDefinition(doc, pos(4, '    user "$'.length), schema, 4000)).toBeNull();
  });
});
