import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
  clearPathCompletionCache,
  tryPathCompletion,
} from "../../../src/completion/handlers/pathCompletion";
import { cursorAtLineEnd, cursorAtToken } from "../../helpers/cursor";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";
import {
  resetMockVscode,
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
  Uri,
} from "../../helpers/vscode";

const bundle = loadSchemaBundle("3.4");

describe("pathCompletion", () => {
  beforeEach(() => {
    resetMockVscode();
    clearPathCompletionCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers path completion for errorfile paths", async () => {
    setMockWorkspaceFile("file:///400.http", "HTTP/1.0 400");
    const doc = createDocument("defaults\n    errorfile 400 ");
    const items = await tryPathCompletion({
      document: doc,
      position: cursorAtLineEnd("defaults\n    errorfile 400 ", 1),
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: {
        kind: "directive-argument",
        line: {
          line: 1,
          tokens: [],
          section: "defaults",
          isSectionHeader: false,
          anonymousDefaults: false,
        },
        tokenIndex: 2,
      } as never,
      partial: "",
    });
    expect(
      items?.some((item) => typeof item.label === "string" && item.label.includes("400.http")),
    ).toBe(true);
  });

  it("completes bind-line crt paths and rejects non-path slots", async () => {
    setMockWorkspaceFolders([{ uri: Uri.file("C:/repo"), name: "repo" }]);
    setMockWorkspaceFile("file:///C:/repo/certs/site.pem", "cert");
    setMockWorkspaceFile("file:///C:/repo/certs/other.pem", "cert");

    const doc = createDocument("frontend web\n    bind :443 ssl crt ");
    const items = await tryPathCompletion({
      document: doc,
      position: cursorAtLineEnd("frontend web\n    bind :443 ssl crt ", 1),
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: {
        kind: "directive-argument",
        line: {
          line: 1,
          tokens: [
            { text: "bind", start: 4, end: 8 },
            { text: ":443", start: 9, end: 13 },
            { text: "ssl", start: 14, end: 17 },
            { text: "crt", start: 18, end: 21 },
          ],
          section: "frontend",
          isSectionHeader: false,
          anonymousDefaults: false,
        },
        tokenIndex: 4,
      } as never,
      partial: "site",
    });
    expect(
      items?.some((item) =>
        (typeof item.label === "string" ? item.label : item.label.label).includes("site.pem"),
      ),
    ).toBe(true);

    const errorfileDoc = createDocument("frontend web\n    errorfile ");
    expect(
      await tryPathCompletion({
        document: errorfileDoc,
        position: cursorAtLineEnd("frontend web\n    errorfile ", 1),
        data: bundle.languageData,
        schema: bundle.schema,
        ctx: {
          kind: "directive-argument",
          line: {
            line: 1,
            tokens: [{ text: "errorfile", start: 4, end: 13 }],
            section: "frontend",
            isSectionHeader: false,
            anonymousDefaults: false,
          },
          tokenIndex: 1,
        } as never,
        partial: "",
      }),
    ).toBeNull();

    expect(
      await tryPathCompletion({
        document: doc,
        position: cursorAtToken("frontend web\n    bind :443 ssl crt ", 1, "bind"),
        data: bundle.languageData,
        schema: bundle.schema,
        ctx: {
          kind: "directive",
          line: doc.lineAt(1) as never,
          tokenIndex: 0,
        } as never,
        partial: "",
      }),
    ).toBeNull();

    resetMockVscode();
    setMockWorkspaceFile("file:///C:/repo/certs/site.pem", "cert");
    const noFolderItems = await tryPathCompletion({
      document: createDocument("frontend web\n    errorfile 400 /tmp/"),
      position: cursorAtLineEnd("frontend web\n    errorfile 400 /tmp/", 1),
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: {
        kind: "directive-argument",
        line: {
          line: 1,
          tokens: [
            { text: "errorfile", start: 4, end: 13 },
            { text: "400", start: 14, end: 17 },
            { text: "/tmp/", start: 18, end: 23 },
          ],
          section: "frontend",
          isSectionHeader: false,
          anonymousDefaults: false,
        },
        tokenIndex: 2,
      } as never,
      partial: "site",
    });
    expect(noFolderItems === null || Array.isArray(noFolderItems)).toBe(true);
  });

  it("derives direct path directives from schema metadata", async () => {
    setMockWorkspaceFile("file:///scripts/hooks.lua", "return {}");
    const content = "global\n    lua-load hooks";
    const doc = createDocument(content);
    const items = await tryPathCompletion({
      document: doc,
      position: cursorAtLineEnd(content, 1),
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: {
        kind: "directive-argument",
        line: {
          line: 1,
          tokens: [
            { text: "lua-load", start: 4, end: 12 },
            { text: "hooks", start: 13, end: 18 },
          ],
          section: "global",
          isSectionHeader: false,
          anonymousDefaults: false,
        },
        tokenIndex: 1,
      } as never,
      partial: "hooks",
    });
    expect(
      items?.some((item) =>
        (typeof item.label === "string" ? item.label : item.label.label).includes("hooks.lua"),
      ),
    ).toBe(true);
  });

  it("filters search mismatches and reuses a recent filesystem search", async () => {
    const findFiles = vi
      .spyOn(vscode.workspace, "findFiles")
      .mockResolvedValue([vscode.Uri.file("C:/repo/scripts/unrelated.lua")]);
    const content = "global\n    lua-load hooks";
    const cc = {
      document: createDocument(content),
      position: cursorAtLineEnd(content, 1),
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: {
        kind: "directive-argument",
        line: {
          line: 1,
          tokens: [
            { text: "lua-load", start: 4, end: 12 },
            { text: "hooks", start: 13, end: 18 },
          ],
          section: "global",
          isSectionHeader: false,
          anonymousDefaults: false,
        },
        tokenIndex: 1,
      } as never,
      partial: "hooks",
    } as const;
    expect(await tryPathCompletion(cc)).toBeNull();
    expect(await tryPathCompletion(cc)).toBeNull();
    expect(findFiles).toHaveBeenCalledTimes(1);
  });

  it("caps path results after schema and prefix filtering", async () => {
    for (let index = 0; index < 101; index += 1) {
      setMockWorkspaceFile(`file:///scripts/file-${index}.lua`, "");
    }
    const content = "global\n    lua-load ";
    const items = await tryPathCompletion({
      document: createDocument(content),
      position: cursorAtLineEnd(content, 1),
      data: bundle.languageData,
      schema: bundle.schema,
      ctx: {
        kind: "directive-argument",
        line: {
          line: 1,
          tokens: [{ text: "lua-load", start: 4, end: 12 }],
          section: "global",
          isSectionHeader: false,
          anonymousDefaults: false,
        },
        tokenIndex: 1,
      } as never,
      partial: "",
    });
    expect(items).toHaveLength(100);
  });
});
