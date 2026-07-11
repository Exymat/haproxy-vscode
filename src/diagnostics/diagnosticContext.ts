import * as vscode from "vscode";

import {
  DocumentAnalysis,
  DocumentLineAnalysis,
  getDocumentAnalysis,
} from "../parser/documentAnalysis";
import { DeprecatedIndex, buildDeprecatedIndex } from "../language/deprecatedIndex";
import { documentUsesExposeDeprecatedDirectives } from "./deprecatedUtils";
import { HaproxyLanguageData } from "../language/languageData";
import { ParsedDocumentEntry } from "../parser/parseCache";
import { ParsedLine } from "../parser";
import { HaproxySchema } from "../schema/types";
import { LogFormatLineMemo, extractLogFormatRegions } from "../language/logFormat";
import { runtimeModeForDocument, RuntimeMode, RuntimeModeCacheEntry } from "../parser/sectionMode";

const runtimeModeCache = new WeakMap<vscode.TextDocument, RuntimeModeCacheEntry>();

export type { AnalyzedLine } from "../parser/lineAnalysis";
export type { LogFormatLineMemo } from "../language/logFormat";

export type LineDiagnosticMemo = DocumentLineAnalysis;

export interface DiagnosticContextOptions {
  languageData?: HaproxyLanguageData;
  deprecatedWarnings?: boolean;
}

export class DiagnosticContext {
  readonly analysis: DocumentAnalysis;
  readonly schema: HaproxySchema;
  readonly parsedEntry: ParsedDocumentEntry;
  readonly parsed: ParsedLine[];
  readonly modesByLine: Array<RuntimeMode | null>;
  readonly lineTexts: string[];
  readonly noPrefix: Set<string>;
  readonly modifierPrefixes: Set<string>;
  readonly namedSections: Set<string>;
  readonly entryPointSections: Set<string>;
  readonly bindDetectKeywords: Set<string>;
  readonly deprecatedIndex: DeprecatedIndex | undefined;
  readonly suppressDeprecated: boolean;

  private readonly logFormatMemo = new Map<number, LogFormatLineMemo>();

  constructor(
    document: vscode.TextDocument,
    schema: HaproxySchema,
    options: DiagnosticContextOptions = {},
    analysis: DocumentAnalysis = getDocumentAnalysis(document, schema),
  ) {
    this.analysis = analysis;
    this.schema = analysis.schema;
    this.parsedEntry = analysis.parsedEntry;
    this.parsed = analysis.parsed;
    const previousModes = runtimeModeCache.get(document);
    const nextModes = runtimeModeForDocument(
      this.parsed,
      document.version,
      this.parsedEntry.reuse,
      previousModes,
      schema,
    );
    runtimeModeCache.set(document, nextModes);
    this.modesByLine = nextModes.modes;
    this.lineTexts = analysis.lineTexts;
    this.noPrefix = analysis.noPrefix;
    this.modifierPrefixes = analysis.modifierPrefixes;
    this.namedSections = analysis.namedSections;
    this.entryPointSections = analysis.entryPointSections;
    this.bindDetectKeywords = analysis.bindDetectKeywords;
    const deprecatedWarnings = options.deprecatedWarnings !== false;
    this.deprecatedIndex = deprecatedWarnings
      ? buildDeprecatedIndex(schema, options.languageData)
      : undefined;
    this.suppressDeprecated =
      this.deprecatedIndex !== undefined && documentUsesExposeDeprecatedDirectives(this.parsed);
  }

  lineText(line: ParsedLine): string {
    return this.analysis.lineText(line);
  }

  modeForLine(line: ParsedLine): RuntimeMode | null {
    return this.modesByLine[line.line] ?? null;
  }

  getLineMemo(line: ParsedLine): LineDiagnosticMemo {
    return this.analysis.getLineAnalysis(line);
  }

  getLogFormatMemo(line: ParsedLine): LogFormatLineMemo {
    let memo = this.logFormatMemo.get(line.line);
    if (!memo) {
      const lineText = this.lineText(line);
      memo = {
        regions: extractLogFormatRegions(lineText, line.tokens, this.schema),
      };
      this.logFormatMemo.set(line.line, memo);
    }
    return memo;
  }
}
