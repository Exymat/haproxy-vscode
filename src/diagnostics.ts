import * as vscode from "vscode";

import { argumentModelDiagnostics } from "./argumentDiagnostics";
import { buildDeprecatedIndex } from "./deprecatedIndex";
import {
  deprecatedDiagnostics,
  documentUsesExposeDeprecatedDirectives,
} from "./deprecatedDiagnostics";
import { expressionDiagnostics } from "./expressionDiagnostics";
import { HaproxyLanguageData } from "./languageData";
import { namedDefaultsDiagnostics } from "./namedDefaultsDiagnostics";
import { aclNameDiagnostics, sectionHeaderDiagnostics } from "./sectionDiagnostics";
import { statementDiagnostics } from "./statementDiagnostics";
import { getParsedDocument } from "./parseCache";
import { ParsedLine } from "./parser";
import {
  conditionalTokenSet,
  HaproxySchema,
  modifierPrefixSet,
  noPrefixKeywordSet,
  prefixFamilies,
  prefixSubcommandSet,
  sectionKeywordSet,
  statsSocketLevelSet,
  tcpRequestPhaseSet,
  tcpResponsePhaseSet,
} from "./schema";
import {
  findStatementRule,
  resolveActionTokenIndex,
  resolvePhaseTokenIndex,
  ruleActionGroup,
} from "./statementLayout";
import {
  isLikelyValue,
  normalizeActionName,
  resolveLongestDirectiveMatch,
  resolveSubcommandSpan,
} from "./tokenUtils";

const DIAG_SOURCE = "haproxy";

type DiagCode =
  | "unknown-keyword"
  | "wrong-section"
  | "unknown-option"
  | "unknown-parameter"
  | "unknown-value"
  | "unknown-action"
  | "unknown-service"
  | "unknown-criterion"
  | "unknown-check-step"
  | "extra-argument"
  | "missing-argument"
  | "deprecated-keyword"
  | "deprecated-action"
  | "named-defaults-required";

function diagRangeForTokens(line: ParsedLine, startIdx: number, endIdx: number): vscode.Range {
  const startTok = line.tokens[startIdx];
  const endTok = line.tokens[endIdx];
  return new vscode.Range(line.line, startTok.start, line.line, endTok.end);
}

function diagRange(line: ParsedLine, tokenIndex: number): vscode.Range {
  return diagRangeForTokens(line, tokenIndex, tokenIndex);
}

function makeDiagnostic(
  range: vscode.Range,
  message: string,
  severity: vscode.DiagnosticSeverity,
  code: DiagCode,
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = code;
  return diagnostic;
}

function isMacroLine(line: ParsedLine, schema: HaproxySchema): boolean {
  const first = line.tokens[0]?.text.toLowerCase();
  return (schema.tokens.macros ?? []).some((macro) => first === macro.toLowerCase());
}

function keywordSections(schema: HaproxySchema, keyword: string): string[] {
  return schema.keywords[keyword.toLowerCase()]?.sections ?? [];
}

function wrongSectionMessage(keyword: string, section: string, sections: string[]): string {
  if (sections.length <= 3) {
    return `'${keyword}' is not supported in section '${section}' (allowed in: ${sections.join(", ")})`;
  }
  return `'${keyword}' is not supported in section '${section}'`;
}

function isOptionLine(line: ParsedLine): boolean {
  const t0 = line.tokens[0]?.text.toLowerCase();
  const t1 = line.tokens[1]?.text.toLowerCase();
  return t0 === "option" || (t0 === "no" && t1 === "option");
}

function optionAllowedInSection(allowed: Set<string>): boolean {
  for (const keyword of allowed) {
    if (keyword.startsWith("option ") || keyword.startsWith("no option")) {
      return true;
    }
  }
  return false;
}

function topLevelDiagnostics(
  line: ParsedLine,
  schema: HaproxySchema,
  allowed: Set<string>,
  noPrefix: Set<string>,
  modifierPrefixes: Set<string>,
): vscode.Diagnostic[] {
  const match = resolveLongestDirectiveMatch(line, allowed, 4, noPrefix, modifierPrefixes);
  if (match.matched) {
    return [];
  }

  if (isOptionLine(line) && optionAllowedInSection(allowed)) {
    return [];
  }

  const range = diagRangeForTokens(line, match.start, Math.max(match.end, match.start));
  const keyword = match.keyword;
  const section = line.section ?? "none";
  const otherSections = keywordSections(schema, keyword);

  if (otherSections.length > 0 && line.section && !otherSections.includes(line.section)) {
    return [
      makeDiagnostic(
        range,
        wrongSectionMessage(keyword, section, otherSections),
        vscode.DiagnosticSeverity.Error,
        "wrong-section",
      ),
    ];
  }

  const prefix = line.tokens[0]?.text.toLowerCase();
  if (prefix && prefixFamilies(schema).includes(prefix)) {
    const sub = resolveSubcommandSpan(
      line,
      allowed,
      prefix,
      prefixSubcommandSet(schema, prefix),
    );
    if (sub && !sub.matched) {
      return [
        makeDiagnostic(
          diagRangeForTokens(line, sub.start, sub.end),
          `Unknown ${prefix} subcommand '${sub.subcommand}' in section '${section}'`,
          vscode.DiagnosticSeverity.Error,
          "unknown-keyword",
        ),
      ];
    }
  }

  if (otherSections.length > 0) {
    return [
      makeDiagnostic(
        range,
        wrongSectionMessage(keyword, section, otherSections),
        vscode.DiagnosticSeverity.Error,
        "wrong-section",
      ),
    ];
  }

  return [
    makeDiagnostic(
      range,
      `Unknown keyword '${keyword}' in section '${section}'`,
      vscode.DiagnosticSeverity.Error,
      "unknown-keyword",
    ),
  ];
}

function unknownNestedDiagnostics(line: ParsedLine, schema: HaproxySchema): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const groups = schema.keyword_groups;
  const conditionals = conditionalTokenSet(schema);
  const statsSocketLevels = statsSocketLevelSet(schema);
  const rule = findStatementRule(schema, line);
  const t0 = line.tokens[0]?.text.toLowerCase();
  const t1 = line.tokens[1]?.text.toLowerCase();

  if (t0 === "option" || (t0 === "no" && t1 === "option")) {
    const idx = t0 === "option" ? 1 : 2;
    const value = line.tokens[idx]?.text.toLowerCase();
    if (value && !(groups.options ?? []).includes(value)) {
      diagnostics.push(
        makeDiagnostic(
          diagRange(line, idx),
          `Unknown option keyword '${line.tokens[idx].text}'`,
          vscode.DiagnosticSeverity.Warning,
          "unknown-option",
        ),
      );
    }
    return diagnostics;
  }

  if (t0 === "mode") {
    return diagnostics;
  }

  if (t0 === "balance") {
    return diagnostics;
  }

  if (t0 === "acl" && line.tokens.length >= 3) {
    const rawCriterion = line.tokens[2].text;
    const parenIdx = rawCriterion.indexOf("(");
    const criterion = (
      parenIdx >= 0 ? rawCriterion.slice(0, parenIdx) : rawCriterion
    ).toLowerCase();
    const allowedCriteria = new Set(
      [...(groups.acl_criteria ?? []), ...(groups.sample_fetches ?? [])].map((v) =>
        v.toLowerCase(),
      ),
    );
    if (!isLikelyValue(criterion, conditionals) && !allowedCriteria.has(criterion)) {
      diagnostics.push(
        makeDiagnostic(
          diagRange(line, 2),
          `Unknown ACL criterion '${rawCriterion}'`,
          vscode.DiagnosticSeverity.Warning,
          "unknown-criterion",
        ),
      );
    }
    return diagnostics;
  }

  if (t0 === "bind" || t0 === "server") {
    return diagnostics;
  }

  if (t0 === "stats" && t1 === "socket") {
    for (let i = 2; i < line.tokens.length; i += 1) {
      const val = line.tokens[i].text.toLowerCase().replace(/\*$/, "");
      if (val === "level" && i + 1 < line.tokens.length) {
        const levelValue = line.tokens[i + 1].text.toLowerCase();
        if (!statsSocketLevels.has(levelValue)) {
          diagnostics.push(
            makeDiagnostic(
              diagRange(line, i + 1),
              `Unknown level '${line.tokens[i + 1].text}' (expected user, operator, or admin)`,
              vscode.DiagnosticSeverity.Warning,
              "unknown-value",
            ),
          );
        }
        i += 1;
      }
    }
    return diagnostics;
  }

  const phaseIdx = resolvePhaseTokenIndex(rule, line);
  if (phaseIdx !== null && (t0 === "tcp-request" || t0 === "tcp-response")) {
    const phases = t0 === "tcp-request" ? tcpRequestPhaseSet(schema) : tcpResponsePhaseSet(schema);
    const phase = line.tokens[phaseIdx].text.toLowerCase();
    if (!phases.has(phase)) {
      const groupName = ruleActionGroup(rule);
      const allowedActions = groupName ? (groups[groupName] ?? []) : [];
      const allowed = new Set(allowedActions.map((v) => v.toLowerCase()));
      if (!allowed.has(phase)) {
        diagnostics.push(
          makeDiagnostic(
            diagRange(line, phaseIdx),
            `Unknown ${t0} phase '${line.tokens[phaseIdx].text}'`,
            vscode.DiagnosticSeverity.Warning,
            "unknown-value",
          ),
        );
      }
    }
  }

  const actionIdx = resolveActionTokenIndex(rule, line);
  if (actionIdx !== null) {
    const rawToken = line.tokens[actionIdx].text;
    const token = normalizeActionName(rawToken);
    const groupName = ruleActionGroup(rule);
    const allowedActions = groupName ? (groups[groupName] ?? []) : [];
    const allowed = new Set(allowedActions.map((v) => v.toLowerCase()));
    if (token && !token.startsWith("lua.") && !allowed.has(token)) {
      diagnostics.push(
        makeDiagnostic(
          diagRange(line, actionIdx),
          `Unknown ${line.tokens[0].text} action '${rawToken}'`,
          vscode.DiagnosticSeverity.Warning,
          "unknown-action",
        ),
      );
    } else if (token === "use-service" && actionIdx + 1 < line.tokens.length) {
      const serviceIdx = actionIdx + 1;
      const serviceName = line.tokens[serviceIdx].text.toLowerCase();
      const services = new Set((groups.services ?? []).map((v) => v.toLowerCase()));
      if (
        services.size > 0 &&
        serviceName &&
        !serviceName.startsWith("lua.") &&
        !services.has(serviceName)
      ) {
        diagnostics.push(
          makeDiagnostic(
            diagRange(line, serviceIdx),
            `Unknown service '${line.tokens[serviceIdx].text}'`,
            vscode.DiagnosticSeverity.Warning,
            "unknown-service",
          ),
        );
      }
    }
  }

  return diagnostics;
}

export interface ComputeDiagnosticsOptions {
  languageData?: HaproxyLanguageData;
  deprecatedWarnings?: boolean;
}

export function computeDiagnostics(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  options: ComputeDiagnosticsOptions = {},
): vscode.Diagnostic[] {
  const parsed = getParsedDocument(document);
  const diagnostics: vscode.Diagnostic[] = [];
  const lineTexts = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
  const deprecatedWarnings = options.deprecatedWarnings !== false;
  const deprecatedIndex = deprecatedWarnings
    ? buildDeprecatedIndex(schema, options.languageData)
    : undefined;
  const suppressDeprecated =
    deprecatedIndex !== undefined && documentUsesExposeDeprecatedDirectives(parsed);

  for (const line of parsed) {
    if (line.tokens.length === 0) {
      continue;
    }
    if (line.isSectionHeader) {
      diagnostics.push(...sectionHeaderDiagnostics(line));
      continue;
    }
    if (isMacroLine(line, schema)) {
      continue;
    }

    const allowed = sectionKeywordSet(schema, line.section);
    const noPrefix = noPrefixKeywordSet(schema);
    const modifierPrefixes = modifierPrefixSet(schema);
    const topDiags = topLevelDiagnostics(line, schema, allowed, noPrefix, modifierPrefixes);
    diagnostics.push(...topDiags);
    if (topDiags.length === 0) {
      diagnostics.push(...statementDiagnostics(line, schema));
      diagnostics.push(...unknownNestedDiagnostics(line, schema));
      diagnostics.push(...argumentModelDiagnostics(line, schema, allowed, noPrefix));
    }
    diagnostics.push(...aclNameDiagnostics(line));
    diagnostics.push(...expressionDiagnostics(line, lineTexts[line.line] ?? "", schema));
    if (deprecatedIndex) {
      diagnostics.push(
        ...deprecatedDiagnostics(parsed, line, schema, deprecatedIndex, suppressDeprecated),
      );
    }
    diagnostics.push(...namedDefaultsDiagnostics(line, schema));
  }
  return diagnostics;
}
