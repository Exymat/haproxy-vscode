import { computeDiagnostics } from "../../src/diagnostics";
import type { HaproxyLanguageData } from "../../src/language/languageData";
import { getParsedDocument } from "../../src/parser/parseCache";
import type { HaproxySchema } from "../../src/schema/types";
import { createDocument, type MockTextDocument, updateDocument } from "../helpers/document";

import { createEditedDocument } from "./helpers";

export interface DiagnosticsBundle {
  schema: HaproxySchema;
  languageData: HaproxyLanguageData;
}

export interface DiagnosticsRunOptions {
  deprecatedWarnings?: boolean;
  unusedSymbols?: boolean;
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
  const runner = createDiagnosticsEditRunner(baseContent, bundle, editLine, options);
  return runner.run(newLineText);
}

export interface DiagnosticsEditRunner {
  originalLineText: string;
  run(newLineText: string): ReturnType<typeof computeDiagnostics>;
}

export function createDiagnosticsEditRunner(
  baseContent: string,
  bundle: DiagnosticsBundle,
  editLine: number,
  options: DiagnosticsRunOptions = {},
): DiagnosticsEditRunner {
  const lines = baseContent.split(/\r?\n/);
  if (editLine < 0 || editLine >= lines.length) {
    throw new Error(`edit line ${editLine} out of range (${lines.length} lines)`);
  }
  const document = createDocument(baseContent);
  getParsedDocument(document);
  runDiagnostics(document, bundle, options);
  return {
    originalLineText: lines[editLine],
    run(newLineText: string) {
      lines[editLine] = newLineText;
      updateDocument(document, lines.join("\n"));
      return runDiagnostics(document, bundle, options);
    },
  };
}

export function runDiagnosticsAfterEditBaseline(
  baseContent: string,
  bundle: DiagnosticsBundle,
  editLine: number,
  newLineText: string,
  options: DiagnosticsRunOptions = {},
): ReturnType<typeof computeDiagnostics> {
  const document = createEditedDocument(baseContent, editLine, newLineText);
  return runDiagnostics(document, bundle, options);
}
