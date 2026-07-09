import {
  createDiskEntry,
  looksLikeHaproxyConfig,
} from "../../../src/symbolIndex/workspaceDocuments";
import { sectionHeaderSet } from "../../../src/schema";
import {
  mockTextDocuments,
  resetVscodeMock,
  setMockWorkspaceFile,
  Uri,
} from "../../__mocks__/vscode";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");
const headers = sectionHeaderSet(schema);

describe("looksLikeHaproxyConfig", () => {
  it("accepts configs that start with a known section header", () => {
    expect(looksLikeHaproxyConfig(["# comment", "", "backend api"], headers)).toBe(true);
    expect(looksLikeHaproxyConfig(["global", "    daemon"], headers)).toBe(true);
  });

  it("rejects configs whose first substantive line is not a section header", () => {
    expect(looksLikeHaproxyConfig(["server { listen 80; }"], headers)).toBe(false);
    expect(looksLikeHaproxyConfig(["# only comments"], headers)).toBe(false);
    expect(looksLikeHaproxyConfig([], headers)).toBe(false);
  });
});

describe("createDiskEntry", () => {
  beforeEach(() => {
    resetVscodeMock();
    mockTextDocuments.length = 0;
  });

  it("returns null for nginx-like .cfg files on disk", async () => {
    setMockWorkspaceFile("file:///nginx.cfg", "server { listen 80; }");

    const entry = await createDiskEntry(Uri.file("file:///nginx.cfg") as never, schema, 4000);

    expect(entry).toBeNull();
  });

  it("indexes valid HAProxy .cfg files from disk", async () => {
    setMockWorkspaceFile("file:///api.cfg", "backend api");

    const entry = await createDiskEntry(Uri.file("file:///api.cfg") as never, schema, 4000);

    expect(entry).not.toBeNull();
    expect(entry?.uriKey).toBe("file:///api.cfg");
  });

  it("returns null for open documents whose content is not HAProxy", async () => {
    const doc = createDocument("server { listen 80; }", "file:///nginx.cfg");
    mockTextDocuments.push(doc as never);

    const entry = await createDiskEntry(Uri.file("file:///nginx.cfg") as never, schema, 4000);

    expect(entry).toBeNull();
  });
});
