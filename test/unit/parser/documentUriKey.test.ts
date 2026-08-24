import { afterEach, describe, expect, it, vi } from "vitest";

import {
  documentContentFingerprint,
  documentOpenCacheFingerprint,
  documentParseCacheFingerprint,
  documentUriKey,
  isOpenTextDocument,
} from "../../../src/parser/documentUriKey";
import { createDocument } from "../../helpers/document";
import { mockTextDocuments } from "../../helpers/vscode";

describe("documentUriKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves non-file document URIs", () => {
    const document = {
      uri: { scheme: "untitled", fsPath: undefined, toString: () => "untitled:HAProxy.cfg" },
      getText: () => "backend api",
    } as never;

    expect(documentUriKey(document)).toBe("untitled:HAProxy.cfg");
    expect(documentContentFingerprint(document)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes Windows file URIs", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    const document = createDocument("backend api", "file:///C:/Projects/test.cfg");
    expect(documentUriKey(document)).toBe("file:///c:/projects/test.cfg");
  });

  it("preserves case on non-Windows file URIs", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const document = createDocument("backend api", "file:///Projects/Test.cfg");
    expect(documentUriKey(document)).toBe("file:///Projects/Test.cfg");
  });

  it("detects Windows drive paths even off Windows", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const document = {
      uri: {
        scheme: "file",
        fsPath: "C:\\Projects\\test.cfg",
        toString: () => "file:///c:/projects/test.cfg",
      },
      getText: () => "backend api",
    } as never;
    expect(documentUriKey(document)).toBe("file:///c:/projects/test.cfg");
  });

  it("uses document version for open-editor cache fingerprints", () => {
    mockTextDocuments.length = 0;
    const document = createDocument("backend api", "file:///open.cfg");
    expect(documentOpenCacheFingerprint(document)).toBe("1");
    expect(isOpenTextDocument(document)).toBe(false);

    mockTextDocuments.push(document as never);
    expect(isOpenTextDocument(document)).toBe(true);
    expect(documentParseCacheFingerprint(document)).toBe("1");
    expect(documentParseCacheFingerprint(document)).not.toBe(documentContentFingerprint(document));
  });

  it("uses content fingerprint for documents that are not open in the editor", () => {
    mockTextDocuments.length = 0;
    const document = createDocument("backend api", "file:///closed.cfg");
    expect(documentParseCacheFingerprint(document)).toBe(documentContentFingerprint(document));
  });
});
