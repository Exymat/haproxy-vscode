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

export interface DiagnosticsRunOptions {
  deprecatedWarnings?: boolean;
  unusedSymbols?: boolean;
  unusedSymbolSections?: boolean;
  maxLines?: number;
}

function computeOptions(
  bundle: DiagnosticsBundle,
  options: DiagnosticsRunOptions = {},
): Parameters<typeof computeDiagnostics>[2] {
  return {
    languageData: bundle.languageData,
    deprecatedWarnings: options.deprecatedWarnings ?? true,
    unusedSymbols: options.unusedSymbols,
    unusedSymbolSections: options.unusedSymbolSections,
    maxLines: options.maxLines,
  };
}

export function runDiagnostics(
  document: MockTextDocument,
  bundle: DiagnosticsBundle,
  options: DiagnosticsRunOptions = {},
): ReturnType<typeof computeDiagnostics> {
  return computeDiagnostics(document, bundle.schema, computeOptions(bundle, options));
}

export function runDiagnosticsCold(
  content: string,
  bundle: DiagnosticsBundle,
  options: DiagnosticsRunOptions = {},
): ReturnType<typeof computeDiagnostics> {
  const document = createDocument(content);
  return runDiagnostics(document, bundle, options);
}

export function runDiagnosticsWarm(
  document: MockTextDocument,
  bundle: DiagnosticsBundle,
  options: DiagnosticsRunOptions = {},
): ReturnType<typeof computeDiagnostics> {
  getParsedDocument(document);
  return runDiagnostics(document, bundle, options);
}

export function runDiagnosticsAfterEdit(
  baseContent: string,
  bundle: DiagnosticsBundle,
  editLine: number,
  newLineText: string,
  options: DiagnosticsRunOptions = {},
): ReturnType<typeof computeDiagnostics> {
  const document = createEditedDocument(baseContent, editLine, newLineText);
  return runDiagnostics(document, bundle, options);
}
