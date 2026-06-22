import { computeDiagnostics } from "../../src/diagnostics";
import type { HaproxyLanguageData } from "../../src/languageData";
import { getParsedDocument } from "../../src/parseCache";
import type { HaproxySchema } from "../../src/schema";
import { createDocument, type MockTextDocument } from "../helpers/document";

import { createEditedDocument } from "./helpers";

export interface DiagnosticsBundle {
  schema: HaproxySchema;
  languageData: HaproxyLanguageData;
}

export function runDiagnostics(
  document: MockTextDocument,
  bundle: DiagnosticsBundle,
  deprecatedWarnings = true,
): ReturnType<typeof computeDiagnostics> {
  return computeDiagnostics(document, bundle.schema, {
    languageData: bundle.languageData,
    deprecatedWarnings,
  });
}

export function runDiagnosticsCold(
  content: string,
  bundle: DiagnosticsBundle,
  deprecatedWarnings = true,
): ReturnType<typeof computeDiagnostics> {
  const document = createDocument(content);
  return runDiagnostics(document, bundle, deprecatedWarnings);
}

export function runDiagnosticsWarm(
  document: MockTextDocument,
  bundle: DiagnosticsBundle,
  deprecatedWarnings = true,
): ReturnType<typeof computeDiagnostics> {
  getParsedDocument(document);
  return runDiagnostics(document, bundle, deprecatedWarnings);
}

export function runDiagnosticsAfterEdit(
  baseContent: string,
  bundle: DiagnosticsBundle,
  editLine: number,
  newLineText: string,
  deprecatedWarnings = true,
): ReturnType<typeof computeDiagnostics> {
  const document = createEditedDocument(baseContent, editLine, newLineText);
  return runDiagnostics(document, bundle, deprecatedWarnings);
}
