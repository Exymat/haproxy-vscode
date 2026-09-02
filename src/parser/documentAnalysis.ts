/** Analyzes HAProxy documents line-by-line against the schema for directives and allowed keywords. */
import * as vscode from "vscode";

import { AnalyzedLine, analyzeLine } from "./lineAnalysis";
import { ParsedDocumentEntry } from "./parseIncremental";
import { ParsedLine } from "./index";
import { HaproxySchema, StatementRule } from "../schema/types";
import { bindDetectKeywordSet, entryPointSectionSet, namedSectionSet } from "../schema/symbols";
import { sectionHasOptionKeywords, sectionKeywordSet } from "../schema/keywords";
import { sectionHeaderSet } from "../schema/layout";
import { modifierPrefixSet, noPrefixKeywordSet } from "../schema/tokens";
import { sectionOutlineByStartLine, SectionSymbolInfo } from "./sectionOutline";
import { DirectiveMatch } from "./tokenUtils";

export interface DocumentLineAnalysis {
  allowed: Set<string>;
  hasOptionKeywords: boolean;
  directiveMatch: DirectiveMatch;
  statementRule: StatementRule | undefined;
  analyzed: AnalyzedLine;
}

export class DocumentAnalysis {
  readonly schema: HaproxySchema;
  readonly sectionHeaders: Set<string>;
  readonly parsedEntry: ParsedDocumentEntry;
  readonly parsed: ParsedLine[];
  readonly lineTexts: string[];
  readonly noPrefix: Set<string>;
  readonly modifierPrefixes: Set<string>;
  readonly namedSections: Set<string>;
  readonly entryPointSections: Set<string>;
  readonly bindDetectKeywords: Set<string>;

  private readonly lineMemo = new Map<string, DocumentLineAnalysis>();
  private sectionsByStartLine: Map<number, SectionSymbolInfo> | undefined;

  constructor(
    private readonly document: vscode.TextDocument,
    schema: HaproxySchema,
    parsedEntry: ParsedDocumentEntry,
  ) {
    this.schema = schema;
    this.sectionHeaders = sectionHeaderSet(schema);
    this.parsedEntry = parsedEntry;
    this.parsed = this.parsedEntry.parsed;
    this.lineTexts = this.parsedEntry.lineTexts;
    this.noPrefix = noPrefixKeywordSet(schema);
    this.modifierPrefixes = modifierPrefixSet(schema);
    this.namedSections = namedSectionSet(schema);
    this.entryPointSections = entryPointSectionSet(schema);
    this.bindDetectKeywords = bindDetectKeywordSet(schema);
  }

  lineText(line: ParsedLine): string {
    return this.lineTexts[line.line] ?? "";
  }

  getLineAnalysis(line: ParsedLine): DocumentLineAnalysis {
    const memoKey = `${line.line}\0${line.section ?? ""}`;
    let memo = this.lineMemo.get(memoKey);
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
      this.lineMemo.set(memoKey, memo);
    }
    return memo;
  }

  sectionOutlineByStartLine(): Map<number, SectionSymbolInfo> {
    if (!this.sectionsByStartLine) {
      this.sectionsByStartLine = sectionOutlineByStartLine(this.document, this.parsed);
    }
    return this.sectionsByStartLine;
  }
}

export { getDocumentAnalysis } from "../document/session";
export { clearDocumentSessions as clearDocumentAnalysisCache } from "../document/sessionStore";
