import * as vscode from "vscode";

import { getParsedDocument } from "./parseCache";
import { buildSectionFoldRanges } from "./sectionOutline";

export function provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
  const parsed = getParsedDocument(document);
  return buildSectionFoldRanges(parsed, document.lineCount).map(
    (range) => new vscode.FoldingRange(range.startLine, range.endLine, vscode.FoldingRangeKind.Region)
  );
}
