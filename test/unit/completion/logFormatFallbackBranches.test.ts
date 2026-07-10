import * as vscode from "vscode";
import { describe, expect, it } from "vitest";

import { tryLogFormatCompletion } from "../../../src/completion/handlers/logFormat";
import { getDocumentContext } from "../../../src/documentContext";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("log-format completion fallback branch behavior", () => {
  it("returns null for empty log-format partials", () => {
    const logDoc = createDocument("defaults\n    log-format");
    const logPosition = new vscode.Position(1, "    log-format".length);
    const logCtx = getDocumentContext(logDoc, logPosition, bundle.schema);
    expect(logCtx).not.toBeNull();
    if (!logCtx) {
      throw new Error("expected log-format document context");
    }

    expect(
      tryLogFormatCompletion({
        document: logDoc,
        position: logPosition,
        data: bundle.languageData,
        schema: bundle.schema,
        ctx: logCtx,
        partial: "",
      }),
    ).toBeNull();
  });
});
