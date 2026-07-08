import * as vscode from "vscode";

import { DeprecatedIndex, buildDeprecatedIndex } from "./deprecatedIndex";
import { documentUsesExposeDeprecatedDirectives } from "./deprecatedUtils";
import { HaproxyLanguageData } from "./languageData";
import { getParsedDocumentEntry, ParsedDocumentEntry } from "./parseCache";
import { ParsedLine } from "./parser";
import {
  bindDetectKeywordSet,
  entryPointSectionSet,
  HaproxySchema,
  modifierPrefixSet,
  namedSectionSet,
  noPrefixKeywordSet,
  sectionHeaderSet,
  sectionHasOptionKeywords,
  sectionKeywordSet,
  StatementRule,
} from "./schema";
import { analyzeLine, AnalyzedLine } from "./lineAnalysis";
import { LogFormatLineMemo, extractLogFormatRegions } from "./logFormat";
import { runtimeModeForDocument, RuntimeMode, RuntimeModeCacheEntry } from "./sectionMode";
import { DirectiveMatch } from "./tokenUtils";

const runtimeModeCache = new WeakMap<vscode.TextDocument, RuntimeModeCacheEntry>();

export type { AnalyzedLine } from "./lineAnalysis";
export type { LogFormatLineMemo } from "./logFormat";

export interface LineDiagnosticMemo {
  allowed: Set<string>;
  hasOptionKeywords: boolean;
  directiveMatch: DirectiveMatch;
  statementRule: StatementRule | undefined;
  analyzed: AnalyzedLine;
}

export interface DiagnosticContextOptions {
  languageData?: HaproxyLanguageData;
  deprecatedWarnings?: boolean;
}

export class DiagnosticContext {
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

  private readonly lineMemo = new Map<number, LineDiagnosticMemo>();
  private readonly logFormatMemo = new Map<number, LogFormatLineMemo>();

  constructor(
    document: vscode.TextDocument,
    schema: HaproxySchema,
    options: DiagnosticContextOptions = {},
  ) {
    this.schema = schema;
    this.parsedEntry = getParsedDocumentEntry(document, {
      sectionHeaders: sectionHeaderSet(schema),
    });
    this.parsed = this.parsedEntry.parsed;
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
    this.lineTexts = this.parsedEntry.lineTexts;
    this.noPrefix = noPrefixKeywordSet(schema);
    this.modifierPrefixes = modifierPrefixSet(schema);
    this.namedSections = namedSectionSet(schema);
    this.entryPointSections = entryPointSectionSet(schema);
    this.bindDetectKeywords = bindDetectKeywordSet(schema);
    const deprecatedWarnings = options.deprecatedWarnings !== false;
    this.deprecatedIndex = deprecatedWarnings
      ? buildDeprecatedIndex(schema, options.languageData)
      : undefined;
    this.suppressDeprecated =
      this.deprecatedIndex !== undefined && documentUsesExposeDeprecatedDirectives(this.parsed);
  }

  lineText(line: ParsedLine): string {
    return this.lineTexts[line.line] ?? "";
  }

  modeForLine(line: ParsedLine): RuntimeMode | null {
    return this.modesByLine[line.line] ?? null;
  }

  getLineMemo(line: ParsedLine): LineDiagnosticMemo {
    let memo = this.lineMemo.get(line.line);
    if (!memo) {
      const allowed = sectionKeywordSet(this.schema, line.section);
      const analyzed = analyzeLine(line, {
        schema: this.schema,
        allowed,
        noPrefix: this.noPrefix,
        modifierPrefixes: this.modifierPrefixes,
      });
      memo = {
        allowed,
        hasOptionKeywords: sectionHasOptionKeywords(this.schema, line.section),
        directiveMatch: analyzed.directiveMatch,
        statementRule: analyzed.statement.rule,
        analyzed,
      };
      this.lineMemo.set(line.line, memo);
    }
    return memo;
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
