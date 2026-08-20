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
  });
});
