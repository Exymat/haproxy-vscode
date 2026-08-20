/** Provides folding ranges for HAProxy configuration sections. */
import * as vscode from "vscode";

import { getLoadedBundleForUri } from "../extension/extensionBundle";
import { getParsedDocument } from "../parser/parseCache";
import { sectionHeaderSet } from "../schema/layout";
import { HaproxySchema } from "../schema/types";
import { buildSectionFoldRanges, getSectionOutline } from "./sectionOutline";

export function provideFoldingRanges(
  document: vscode.TextDocument,
  schema?: HaproxySchema,
): vscode.FoldingRange[] {
  const bundle = getLoadedBundleForUri(document.uri);
  const effectiveSchema = schema ?? bundle?.schema;
  const parsed = getParsedDocument(document, {
    sectionHeaders: effectiveSchema ? sectionHeaderSet(effectiveSchema) : undefined,
  });
  return buildSectionFoldRanges(getSectionOutline(document, parsed)).map(
    (range) =>
      new vscode.FoldingRange(range.startLine, range.endLine, vscode.FoldingRangeKind.Region),
  );
}
