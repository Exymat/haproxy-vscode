import { refreshDocumentsInFolders } from "../../../src/extensionRefresh";

describe("extensionRefresh", () => {
  it("schedules all documents when the global folder scope changed", () => {
    const scheduled: string[] = [];
    const documents = [
      { uri: { toString: () => "file:///a.cfg" }, languageId: "haproxy" },
      { uri: { toString: () => "file:///b.txt" }, languageId: "plaintext" },
    ] as never[];

    refreshDocumentsInFolders([undefined], documents, (document) => {
      scheduled.push(document.uri.toString());
    });

    expect(scheduled).toEqual(["file:///a.cfg", "file:///b.txt"]);
  });

  it("schedules only documents in the affected workspace folders", () => {
    const scheduled: string[] = [];
    const documents = [
      { uri: { toString: () => "file:///folder-a/app.cfg" }, languageId: "haproxy" },
      { uri: { toString: () => "file:///folder-b/app.cfg" }, languageId: "haproxy" },
      { uri: { toString: () => "file:///folder-a/readme.txt" }, languageId: "plaintext" },
    ] as never[];

    refreshDocumentsInFolders(
      ["file:///folder-a"],
      documents,
      (document) => {
        scheduled.push(document.uri.toString());
      },
      (uri) => {
        const key = uri.toString();
        if (key.startsWith("file:///folder-a/")) {
          return { uri: { toString: () => "file:///folder-a" } } as never;
        }
        if (key.startsWith("file:///folder-b/")) {
          return { uri: { toString: () => "file:///folder-b" } } as never;
        }
        return undefined;
      },
    );

    expect(scheduled).toEqual(["file:///folder-a/app.cfg"]);
  });
});
