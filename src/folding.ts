import * as vscode from "vscode";

import { getLoadedBundleForUri } from "./extensionBundle";
import { getParsedDocument } from "./parseCache";
import { sectionHeaderSet } from "./schema/layout";
import { buildSectionFoldRanges, getSectionOutline } from "./sectionOutline";

export function provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
  const bundle = getLoadedBundleForUri(document.uri);
  const parsed = getParsedDocument(document, {
    sectionHeaders: bundle ? sectionHeaderSet(bundle.schema) : undefined,
  });
  return buildSectionFoldRanges(getSectionOutline(document, parsed)).map(
    (range) =>
      new vscode.FoldingRange(range.startLine, range.endLine, vscode.FoldingRangeKind.Region),
  );
}
