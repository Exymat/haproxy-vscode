import * as vscode from "vscode";

import { getParsedDocument } from "./parseCache";
import { buildSectionFoldRanges, getSectionOutline } from "./sectionOutline";

export function provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
  const parsed = getParsedDocument(document);
  return buildSectionFoldRanges(getSectionOutline(document, parsed)).map(
    (range) =>
      new vscode.FoldingRange(range.startLine, range.endLine, vscode.FoldingRangeKind.Region),
  );
}
