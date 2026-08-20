/** Semantic highlighting for backend reference tokens. */
import * as vscode from "vscode";

import { HaproxySchema } from "../schema/types";
import { getSymbolIndex } from "../symbolIndex";

export const BACKEND_REFERENCE_TOKEN_TYPE = "backendReference";

export const backendReferenceLegend = new vscode.SemanticTokensLegend([
  BACKEND_REFERENCE_TOKEN_TYPE,
]);

const BACKEND_REFERENCE_KEYWORDS = new Set(["use_backend", "default_backend"]);

function isBackendReferenceLine(lineText: string): boolean {
  const trimmed = lineText.trimStart().toLowerCase();
  for (const keyword of BACKEND_REFERENCE_KEYWORDS) {
    if (trimmed.startsWith(`${keyword} `) || trimmed === keyword) {
      return true;
    }
  }
  return false;
}

export function provideSemanticTokens(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
): vscode.SemanticTokens {
  const builder = new vscode.SemanticTokensBuilder(backendReferenceLegend);
  if (document.lineCount > maxLines) {
    return builder.build();
  }

  const index = getSymbolIndex(document, schema, maxLines);
  if (!index) {
    return builder.build();
  }

  for (const reference of index.references) {
    if (reference.kind !== "proxy-section" || reference.role !== "reference") {
      continue;
    }
    const lineText = document.lineAt(reference.line).text;
    if (!isBackendReferenceLine(lineText)) {
      continue;
    }
    builder.push(reference.line, reference.start, reference.end - reference.start, 0);
  }

  return builder.build();
}
