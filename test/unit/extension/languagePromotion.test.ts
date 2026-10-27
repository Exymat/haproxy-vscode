import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  beginTextDocumentOpen,
  considerPlaintextEdit,
  noteTextDocumentClosed,
  promoteOpenPlaintextDocuments,
  promotePlaintextDocument,
  resetLanguagePromotionState,
} from "../../../src/extension/languagePromotion";
import { languages, mockTextDocuments, resetMockVscode, workspace } from "../../helpers/vscode";

function textDocument(
  content: string,
  options?: { uri?: string; scheme?: string; languageId?: string; omitScheme?: boolean },
) {
  const lines = content.split("\n");
  const uri: { scheme?: string; toString: () => string } = {
    toString: () => options?.uri ?? "file:///sample.txt",
  };
  if (!options?.omitScheme) {
    uri.scheme = options?.scheme ?? "file";
  }
  return {
    uri,
    languageId: options?.languageId ?? "plaintext",
    version: 1,
    get lineCount() {
      return lines.length;
    },
    lineAt: (index: number) => ({ text: lines[index] ?? "" }),
    getText: () => lines.join("\n"),
    setContent(next: string) {
      lines.splice(0, lines.length, ...next.split("\n"));
    },
  };
}

describe("plaintext language promotion", () => {
  beforeEach(() => {
    resetMockVscode();
    resetLanguagePromotionState();
    languages.setTextDocumentLanguage.mockClear();
  });

  afterEach(async () => {
    await Promise.resolve();
    resetLanguagePromotionState();
  });

  it("promotes a plaintext file and an untitled document", async () => {
    const file = textDocument("frontend fe\n");
    const untitled = textDocument("backend api\n", {
      scheme: "untitled",
      uri: "untitled:Untitled-1",
    });

    expect(beginTextDocumentOpen(file as never)).toBe("promote");
    expect(beginTextDocumentOpen(untitled as never)).toBe("promote");
    expect(await promotePlaintextDocument(file as never)).toBe(true);
    expect(await promotePlaintextDocument(untitled as never)).toBe(true);
    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(file, "haproxy");
    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(untitled, "haproxy");
    expect(await promotePlaintextDocument(file as never)).toBe(false);
  });

  it("leaves non-configs, other languages, and non-file documents alone", async () => {
    const nginx = textDocument("server { listen 80; }\n");
    const ini = textDocument("frontend fe\n", { languageId: "ini", uri: "file:///app.ini" });
    const output = textDocument("frontend fe\n", { scheme: "output", uri: "output://log" });

    expect(beginTextDocumentOpen(nginx as never)).toBe("promote");
    expect(beginTextDocumentOpen(ini as never)).toBe("ignore");
    expect(beginTextDocumentOpen(output as never)).toBe("ignore");
    expect(await promotePlaintextDocument(nginx as never)).toBe(false);
    expect(await promotePlaintextDocument(ini as never)).toBe(false);
    expect(await promotePlaintextDocument(output as never)).toBe(false);

    considerPlaintextEdit(ini as never);
    considerPlaintextEdit(output as never);
    await Promise.resolve();
    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();
  });

  it("reads a missing scheme from the URI text", async () => {
    const file = textDocument("frontend fe\n", { omitScheme: true, uri: "file:///bare.cfg" });
    const bare = textDocument("frontend fe\n", { omitScheme: true, uri: "not-a-uri" });

    expect(beginTextDocumentOpen(file as never)).toBe("promote");
    expect(beginTextDocumentOpen(bare as never)).toBe("ignore");
    expect(await promotePlaintextDocument(file as never)).toBe(true);
    expect(await promotePlaintextDocument(bare as never)).toBe(false);
  });

  it("returns false when the language switch fails and can retry", async () => {
    languages.setTextDocumentLanguage.mockRejectedValueOnce(new Error("denied"));
    const doc = textDocument("frontend fe\n");

    expect(await promotePlaintextDocument(doc as never)).toBe(false);
    expect(await promotePlaintextDocument(doc as never)).toBe(true);
    expect(doc.languageId).toBe("haproxy");
  });

  it("does not start a second promotion while one is in flight", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    languages.setTextDocumentLanguage.mockImplementationOnce(() => gate);
    const doc = textDocument("backend api\n");

    const first = promotePlaintextDocument(doc as never);
    expect(await promotePlaintextDocument(doc as never)).toBe(false);
    release();
    expect(await first).toBe(true);
  });

  it("keeps plaintext after a same-turn switch away from HAProxy", async () => {
    const doc = textDocument("frontend web\n", { uri: "file:///web.cfg" });
    expect(beginTextDocumentOpen(doc as never)).toBe("promote");
    expect(await promotePlaintextDocument(doc as never)).toBe(true);
    languages.setTextDocumentLanguage.mockClear();

    noteTextDocumentClosed(doc as never);
    doc.languageId = "plaintext";
    expect(beginTextDocumentOpen(doc as never)).toBe("ignore");
    considerPlaintextEdit(doc as never);
    expect(await promotePlaintextDocument(doc as never)).toBe(false);
    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();
  });

  it("drops the plaintext override when that document is closed later", async () => {
    const doc = textDocument("frontend web\n", {
      uri: "file:///web.cfg",
      languageId: "haproxy-3.2",
    });
    expect(beginTextDocumentOpen(doc as never)).toBe("haproxy");
    doc.languageId = "plaintext";
    noteTextDocumentClosed(doc as never);
    expect(beginTextDocumentOpen(doc as never)).toBe("ignore");
    await Promise.resolve();

    noteTextDocumentClosed(doc as never);
    await Promise.resolve();
    expect(beginTextDocumentOpen(doc as never)).toBe("promote");
  });

  it("promotes again when plaintext returns after the close turn", async () => {
    const doc = textDocument("frontend fe\n", { uri: "file:///a.cfg", languageId: "haproxy" });
    expect(beginTextDocumentOpen(doc as never)).toBe("haproxy");
    noteTextDocumentClosed(doc as never);
    await Promise.resolve();

    doc.languageId = "plaintext";
    expect(beginTextDocumentOpen(doc as never)).toBe("promote");
    expect(await promotePlaintextDocument(doc as never)).toBe(true);
  });

  it("does not stick an override when the document reopens as another language", () => {
    const doc = textDocument("frontend fe\n", { languageId: "haproxy", uri: "file:///a.cfg" });
    expect(beginTextDocumentOpen(doc as never)).toBe("haproxy");
    noteTextDocumentClosed(doc as never);
    doc.languageId = "ini";
    expect(beginTextDocumentOpen(doc as never)).toBe("ignore");

    doc.languageId = "plaintext";
    expect(beginTextDocumentOpen(doc as never)).toBe("promote");
  });

  it("does not treat closing an ordinary plaintext file as a language override", () => {
    const notes = textDocument("hello\n", { uri: "file:///notes.txt" });
    noteTextDocumentClosed(notes as never);
    const opened = textDocument("frontend fe\n", { uri: "file:///notes.txt" });
    expect(beginTextDocumentOpen(opened as never)).toBe("promote");
  });

  it("ignores the close emitted while the language is switching", async () => {
    workspace.onDidCloseTextDocument((document) => {
      noteTextDocumentClosed(document as never);
    });
    const doc = textDocument("frontend fe\n", { uri: "file:///switch.cfg" });
    expect(beginTextDocumentOpen(doc as never)).toBe("promote");
    expect(await promotePlaintextDocument(doc as never)).toBe(true);
    languages.setTextDocumentLanguage.mockClear();

    doc.languageId = "plaintext";
    considerPlaintextEdit(doc as never);
    await Promise.resolve();
    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(doc, "haproxy");
  });

  it("promotes a plaintext edit once a witness line is present", async () => {
    const doc = textDocument("global\n");
    considerPlaintextEdit(doc as never);
    await Promise.resolve();
    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();

    doc.setContent("global\n    maxconn 2000\n");
    considerPlaintextEdit(doc as never);
    await Promise.resolve();
    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(doc, "haproxy");
  });

  it("promotes plaintext documents that are already open", async () => {
    const match = textDocument("frontend fe\n", { uri: "file:///a.txt" });
    const nginx = textDocument("server { listen 80; }\n", { uri: "file:///b.txt" });
    const ini = textDocument("frontend fe\n", { uri: "file:///c.ini", languageId: "ini" });
    mockTextDocuments.push(match as never, nginx as never, ini as never);

    promoteOpenPlaintextDocuments();
    await Promise.resolve();

    expect(languages.setTextDocumentLanguage).toHaveBeenCalledTimes(1);
    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(match, "haproxy");
  });
});
