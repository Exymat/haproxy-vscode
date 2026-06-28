import * as vscode from "vscode";

import { getLoadedBundle } from "./extensionBundle";
import { getParsedDocument } from "./parseCache";
import { sectionHeaderSet } from "./schema";
import { buildSectionFoldRanges, getSectionOutline } from "./sectionOutline";

export function provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
  const bundle = getLoadedBundle();
  const parsed = getParsedDocument(document, {
    sectionHeaders: bundle ? sectionHeaderSet(bundle.schema) : undefined,
  });
  return buildSectionFoldRanges(getSectionOutline(document, parsed)).map(
    (range) =>
      new vscode.FoldingRange(range.startLine, range.endLine, vscode.FoldingRangeKind.Region),
  );
}
