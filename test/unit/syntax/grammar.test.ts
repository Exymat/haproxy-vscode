import * as path from "node:path";

import {
  grammarPathForVersion,
  haproxyDocumentSelector,
  isHaproxyLanguageId,
  languageIdForVersion,
  syncAllOpenDocumentGrammarLanguages,
  syncDocumentGrammarLanguage,
  versionForLanguageId,
} from "../../../src/extension/grammar";
import { SUPPORTED_HAPROXY_VERSIONS } from "../../../src/extension/version";
import {
  languages,
  mockTextDocuments,
  resetMockVscode,
  setMockConfig,
  setMockConfigForUri,
} from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";

describe("grammar paths and language ids", () => {
  it("builds version-specific grammar paths", () => {
    const root = "/ext";
    expect(grammarPathForVersion(root, "3.2")).toBe(
      path.join(root, "syntaxes", "haproxy-3.2.tmLanguage.json"),
    );
  });

  it("maps versions to stable per-version language ids", () => {
    for (const version of SUPPORTED_HAPROXY_VERSIONS) {
      expect(languageIdForVersion(version)).toBe(`haproxy-${version}`);
      expect(versionForLanguageId(`haproxy-${version}`)).toBe(version);
    }
  });

  it("recognizes base and version-specific haproxy language ids", () => {
    expect(isHaproxyLanguageId("haproxy")).toBe(true);
    expect(isHaproxyLanguageId("haproxy-3.4")).toBe(true);
    expect(isHaproxyLanguageId("plaintext")).toBe(false);
    expect(versionForLanguageId("haproxy")).toBeUndefined();
    expect(versionForLanguageId("haproxy-9.9")).toBeUndefined();
  });

  it("registers a document selector for every supported grammar language", () => {
    const selector = haproxyDocumentSelector();
    expect(selector).toEqual(
      expect.arrayContaining([
        { language: "haproxy" },
        ...SUPPORTED_HAPROXY_VERSIONS.map((version) => ({ language: `haproxy-${version}` })),
      ]),
    );
  });
});

describe("syncDocumentGrammarLanguage", () => {
  beforeEach(() => {
    resetMockVscode();
    mockTextDocuments.length = 0;
    vi.mocked(languages.setTextDocumentLanguage).mockClear();
  });

  function haproxyDoc(uri: string, languageId = "haproxy") {
    return {
      uri: { toString: () => uri },
      languageId,
      version: 1,
      lineCount: 1,
      lineAt: () => ({ text: "global" }),
      getText: () => "global",
    };
  }

  it("assigns the grammar language from workspace folder configuration", async () => {
    const doc = haproxyDoc("file:///workspace-a/app.cfg");
    setMockConfigForUri(doc.uri, "haproxy", "version", "2.6");

    const changed = await syncDocumentGrammarLanguage(doc as never);

    expect(changed).toBe(true);
    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(doc, "haproxy-2.6");
    expect(doc.languageId).toBe("haproxy-2.6");
  });

  it("returns false when the document already uses the configured grammar language", async () => {
    const doc = haproxyDoc("file:///workspace-b/app.cfg", "haproxy-3.4");
    setMockConfigForUri(doc.uri, "haproxy", "version", "3.4");

    const changed = await syncDocumentGrammarLanguage(doc as never);

    expect(changed).toBe(false);
    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();
  });

  it("ignores non-haproxy documents", async () => {
    const doc = haproxyDoc("file:///workspace/plain.txt", "plaintext");

    const changed = await syncDocumentGrammarLanguage(doc as never);

    expect(changed).toBe(false);
    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();
  });

  it("syncs all open haproxy documents independently", async () => {
    const docA = haproxyDoc("file:///workspace-a/app.cfg");
    const docB = haproxyDoc("file:///workspace-b/app.cfg");
    setMockConfigForUri(docA.uri, "haproxy", "version", "2.6");
    setMockConfigForUri(docB.uri, "haproxy", "version", "3.4");
    mockTextDocuments.push(docA as never, docB as never);

    await syncAllOpenDocumentGrammarLanguages();

    expect(docA.languageId).toBe("haproxy-2.6");
    expect(docB.languageId).toBe("haproxy-3.4");
  });

  it("falls back to workspace version when no uri-scoped override exists", async () => {
    const doc = haproxyDoc("file:///workspace/app.cfg");
    setMockConfig("haproxy", "version", "3.0");

    await syncDocumentGrammarLanguage(doc as never);

    expect(doc.languageId).toBe("haproxy-3.0");
  });

  it("loads real extension grammars referenced by the manifest", () => {
    const context = mockExtensionContext();
    for (const version of SUPPORTED_HAPROXY_VERSIONS) {
      const grammarPath = grammarPathForVersion(context.extensionPath, version);
      expect(grammarPath).toContain(`haproxy-${version}.tmLanguage.json`);
    }
  });
});
