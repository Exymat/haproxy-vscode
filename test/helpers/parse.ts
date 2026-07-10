import type { TextDocument } from "vscode";

import {
  parseDocument as parseDocumentImpl,
  parseDocumentLines as parseDocumentLinesImpl,
  type ParseOptions,
} from "../../src/parser";

import { parseOptionsWithSchema } from "./formatOptions";
import type { SupportedVersion } from "./schema";

function mergeParseOptions(version: SupportedVersion, options?: ParseOptions): ParseOptions {
  return { ...parseOptionsWithSchema(version), ...options };
}

export function parseDocument(
  document: TextDocument,
  version: SupportedVersion = "3.2",
  options?: ParseOptions,
) {
  return parseDocumentImpl(document, mergeParseOptions(version, options));
}

export function parseDocumentLines(
  lineTexts: string[],
  version: SupportedVersion = "3.2",
  options?: ParseOptions,
) {
  return parseDocumentLinesImpl(lineTexts, mergeParseOptions(version, options));
}
