import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { normalizeUriKey } from "../../../src/core/uriKey";
import { documentUriKey } from "../../../src/parser/documentUriKey";
import { workspaceUriKey } from "../../../src/symbolIndex/workspaceUri";
import { createDocument } from "../../helpers/document";
import { Uri } from "../../helpers/vscode";

describe("uri key helpers", () => {
  it("normalizes file URIs consistently for documents and workspace lookups", () => {
    const uri = Uri.file("C:/Repo/Config/haproxy.cfg") as vscode.Uri;
    const document = createDocument("global", uri.toString());
    expect(documentUriKey(document)).toBe(workspaceUriKey(uri));
    expect(documentUriKey(document)).toBe(normalizeUriKey(uri));
    expect(documentUriKey(document)).toBe("file://c:/repo/config/haproxy.cfg");
  });

  it("lowercases Windows file URIs when only the URI string exposes the drive letter", () => {
    const uri = {
      scheme: "file",
      fsPath: "file://C:/Repo/Config/haproxy.cfg",
      toString: () => "file://C:/Repo/Config/haproxy.cfg",
    } as vscode.Uri;
    expect(normalizeUriKey(uri)).toBe("file://c:/repo/config/haproxy.cfg");
  });

  it("preserves case for POSIX file URIs outside Windows", () => {
    if (process.platform === "win32") {
      return;
    }
    const uri = {
      scheme: "file",
      fsPath: "/Repo/Config/haproxy.cfg",
      toString: () => "file:///Repo/Config/haproxy.cfg",
    } as vscode.Uri;
    expect(normalizeUriKey(uri)).toBe("file:///Repo/Config/haproxy.cfg");
  });
});
