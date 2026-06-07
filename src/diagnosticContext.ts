import * as vscode from "vscode";

import { DeprecatedIndex, buildDeprecatedIndex } from "./deprecatedIndex";
import { documentUsesExposeDeprecatedDirectives } from "./deprecatedUtils";
import { HaproxyLanguageData } from "./languageData";
import { getParsedDocument } from "./parseCache";
import { ParsedLine } from "./parser";
import {
  HaproxySchema,
  StatementRule,
  modifierPrefixSet,
  noPrefixKeywordSet,
  sectionKeywordSet,
} from "./schema";
import { findStatementRule } from "./statementLayout";
import { RuntimeMode, runtimeModeForLine } from "./sectionMode";
import { DirectiveMatch, resolveLongestDirectiveMatch } from "./tokenUtils";

export interface LineDiagnosticMemo {
  allowed: Set<string>;
  directiveMatch: DirectiveMatch;
  statementRule: StatementRule | undefined;
}

export interface DiagnosticContextOptions {
  languageData?: HaproxyLanguageData;
  deprecatedWarnings?: boolean;
}

export class DiagnosticContext {
  readonly schema: HaproxySchema;
  readonly parsed: ParsedLine[];
  readonly modesByLine: Array<RuntimeMode | null>;
  readonly lineTexts: string[];
  readonly noPrefix: Set<string>;
  readonly modifierPrefixes: Set<string>;
  readonly deprecatedIndex: DeprecatedIndex | undefined;
  readonly suppressDeprecated: boolean;

  private readonly lineMemo = new Map<number, LineDiagnosticMemo>();

  constructor(
    document: vscode.TextDocument,
    schema: HaproxySchema,
    options: DiagnosticContextOptions = {},
  ) {
    this.schema = schema;
    this.parsed = getParsedDocument(document);
    this.modesByLine = runtimeModeForLine(this.parsed);
    this.lineTexts = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
    this.noPrefix = noPrefixKeywordSet(schema);
    this.modifierPrefixes = modifierPrefixSet(schema);
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
      memo = {
        allowed,
        directiveMatch: resolveLongestDirectiveMatch(
          line,
          allowed,
          4,
          this.noPrefix,
          this.modifierPrefixes,
        ),
        statementRule: findStatementRule(this.schema, line),
      };
      this.lineMemo.set(line.line, memo);
    }
    return memo;
  }
}
