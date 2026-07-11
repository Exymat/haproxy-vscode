import * as vscode from "vscode";

import { DiagnosticContext } from "./diagnosticContext";
import { diagRange, diagRangeForTokens, makeDiagnostic } from "./diagnosticUtils";
import { conditionalStartIndex } from "../language/directiveUtils";
import { nestedDiagnosticKeywordSet, statementRuleKeywordSet } from "./diagnosticKeywordSets";
import { resolveLineOptionStartIndex } from "../language/lineOptionSpan";
import { isOptionLine, optionNameTokenIndex } from "../parser/optionLine";
import { ParsedLine } from "../parser";
import { HaproxySchema } from "../schema/types";
import { symbolStringList } from "../schema/symbols";
import { semanticRecord, dynamicActionPrefixes } from "../schema/semantic";
import { validationObjectArray } from "../schema/validation";
import { keywordGroupSet, prefixSubcommandSet } from "../schema/keywords";
import {
  prefixFamilySet,
  statsSocketLevelSet,
  tcpRequestPhaseSet,
  tcpResponsePhaseSet,
} from "../schema/layout";
import { conditionalTokenSet } from "../schema/tokens";
import { RuntimeMode } from "../parser/sectionMode";
import {
  resolveActionTokenIndex,
  resolvePhaseTokenIndex,
  ruleActionGroup,
} from "../formatting/statementLayout";
import {
  isLikelyValue,
  lowerToken,
  normalizeActionName,
  normalizedOptionToken,
  resolveSubcommandSpan,
} from "../parser/tokenUtils";

function keywordSections(schema: HaproxySchema, keyword: string): string[] {
  return schema.keywords[lowerToken(keyword)]?.sections ?? [];
}

function wrongSectionMessage(keyword: string, section: string, sections: string[]): string {
  if (sections.length <= 3) {
    return `'${keyword}' is not supported in section '${section}' (allowed in: ${sections.join(", ")})`;
  }
  return `'${keyword}' is not supported in section '${section}'`;
}

function optionAllowedInSection(memo: { hasOptionKeywords: boolean }): boolean {
  return memo.hasOptionKeywords;
}

function wrongContextMessage(keyword: string, mode: RuntimeMode, contexts: string[]): string {
  return `'${keyword}' is not supported in mode '${mode}' (allowed in: ${contexts.join(", ")})`;
}

function runtimeModeContextValues(schema: HaproxySchema): Set<string> {
  const contextValues = symbolStringList(schema, "runtime_mode_context_values");
  if (contextValues.length > 0) {
    return new Set(contextValues);
  }
  return new Set(symbolStringList(schema, "runtime_modes"));
}

function modeContextDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  keyword: string,
  contexts: string[],
  mode: RuntimeMode,
  schema: HaproxySchema,
): vscode.Diagnostic | null {
  const runtimeModes = runtimeModeContextValues(schema);
  let hasModeContext = false;
  let modeSupported = false;
  for (const context of contexts) {
    const normalized = lowerToken(context);
    if (runtimeModes.has(normalized)) {
      hasModeContext = true;
      if (normalized === mode) {
        modeSupported = true;
        break;
      }
    }
  }
  if (!hasModeContext || modeSupported) {
    return null;
  }
  return makeDiagnostic(
    diagRange(line, tokenIndex),
    wrongContextMessage(keyword, mode, contexts),
    vscode.DiagnosticSeverity.Warning,
    "wrong-context",
  );
}

export function topLevelDiagnostics(ctx: DiagnosticContext, line: ParsedLine): vscode.Diagnostic[] {
  const { allowed, directiveMatch: match, hasOptionKeywords } = ctx.getLineMemo(line);
  if (match.matched) {
    return [];
  }

  if (isOptionLine(line, ctx.schema) && optionAllowedInSection({ hasOptionKeywords })) {
    return [];
  }

  const range = diagRangeForTokens(line, match.start, Math.max(match.end, match.start));
  const keyword = match.keyword;
  const section = line.section ?? "none";
  const otherSections = keywordSections(ctx.schema, keyword);

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

  const prefix = lowerToken(line.tokens[0]?.text ?? "");
  if (prefix && prefixFamilySet(ctx.schema).has(prefix)) {
    const sub = resolveSubcommandSpan(
      line,
      allowed,
      prefix,
      prefixSubcommandSet(ctx.schema, prefix),
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

export function contextDiagnostics(ctx: DiagnosticContext, line: ParsedLine): vscode.Diagnostic[] {
  const mode = ctx.modeForLine(line);
  if (!mode || line.tokens.length === 0) {
    return [];
  }
  const { directiveMatch: top, statementRule: rule } = ctx.getLineMemo(line);
  const diagnostics: vscode.Diagnostic[] = [];
  const t0 = lowerToken(line.tokens[0]?.text ?? "");

  if (top.matched) {
    const kw = ctx.schema.keywords[lowerToken(top.keyword)];
    if (kw?.contexts?.length) {
      const diag = modeContextDiagnostic(line, top.start, kw.name, kw.contexts, mode, ctx.schema);
      if (diag) {
        diagnostics.push(diag);
      }
    }
  }

  if (isOptionLine(line, ctx.schema)) {
    const idx = optionNameTokenIndex(line, ctx.schema);
    const option = lowerToken(line.tokens[idx]?.text ?? "");
    if (option) {
      const contexts = ctx.schema.keyword_group_contexts?.options?.[option];
      if (contexts?.length) {
        const diag = modeContextDiagnostic(
          line,
          idx,
          `option ${option}`,
          contexts,
          mode,
          ctx.schema,
        );
        if (diag) {
          diagnostics.push(diag);
        }
      }
    }
  }

  if (t0 === "bind" || t0 === "server" || t0 === "default-server") {
    const groupName = rule?.group;
    const start = resolveLineOptionStartIndex(ctx.schema, line, rule);
    if (groupName && start >= 0) {
      const groupContexts = ctx.schema.keyword_group_contexts?.[groupName] ?? {};
      if (Object.keys(groupContexts).length === 0) {
        return diagnostics;
      }
      const allowedGroup = keywordGroupSet(ctx.schema, groupName);
      const limit = conditionalStartIndex(line, 0);
      for (let i = start; i < limit; i += 1) {
        const option = normalizedOptionToken(line.tokens[i].text);
        if (!allowedGroup.has(option)) {
          continue;
        }
        const contexts = groupContexts[option];
        if (!contexts?.length) {
          continue;
        }
        const diag = modeContextDiagnostic(line, i, option, contexts, mode, ctx.schema);
        if (diag) {
          diagnostics.push(diag);
        }
      }
    }
  }

  return diagnostics;
}

type NestedKeywordHandler = (
  ctx: DiagnosticContext,
  line: ParsedLine,
) => vscode.Diagnostic[] | null;

function handleOptionLine(ctx: DiagnosticContext, line: ParsedLine): vscode.Diagnostic[] | null {
  if (!isOptionLine(line, ctx.schema)) {
    return null;
  }
  const idx = optionNameTokenIndex(line, ctx.schema);
  const value = lowerToken(line.tokens[idx]?.text ?? "");
  if (value && !keywordGroupSet(ctx.schema, "options").has(value)) {
    return [
      makeDiagnostic(
        diagRange(line, idx),
        `Unknown option keyword '${line.tokens[idx].text}'`,
        vscode.DiagnosticSeverity.Warning,
        "unknown-option",
      ),
    ];
  }
  return [];
}

function handleSkippedKeywordLine(
  ctx: DiagnosticContext,
  line: ParsedLine,
): vscode.Diagnostic[] | null {
  const t0 = lowerToken(line.tokens[0]?.text ?? "");
  if (t0 && statementRuleKeywordSet(ctx.schema).has(t0)) {
    return [];
  }
  return null;
}

function handleAclLine(ctx: DiagnosticContext, line: ParsedLine): vscode.Diagnostic[] | null {
  const t0 = lowerToken(line.tokens[0]?.text ?? "");
  if (t0 !== "acl" || line.tokens.length < 3) {
    return null;
  }
  const conditionals = conditionalTokenSet(ctx.schema);
  const rawCriterion = line.tokens[2].text;
  const parenIdx = rawCriterion.indexOf("(");
  const criterion = lowerToken(parenIdx >= 0 ? rawCriterion.slice(0, parenIdx) : rawCriterion);
  const aclCriteria = keywordGroupSet(ctx.schema, "acl_criteria");
  const sampleFetches = keywordGroupSet(ctx.schema, "sample_fetches");
  if (
    !isLikelyValue(criterion, conditionals) &&
    !aclCriteria.has(criterion) &&
    !sampleFetches.has(criterion)
  ) {
    return [
      makeDiagnostic(
        diagRange(line, 2),
        `Unknown ACL criterion '${rawCriterion}'`,
        vscode.DiagnosticSeverity.Warning,
        "unknown-criterion",
      ),
    ];
  }
  return [];
}

function handleStatsSocketLine(
  ctx: DiagnosticContext,
  line: ParsedLine,
): vscode.Diagnostic[] | null {
  const t0 = lowerToken(line.tokens[0]?.text ?? "");
  const t1 = lowerToken(line.tokens[1]?.text ?? "");
  if (t0 !== "stats" || t1 !== "socket") {
    return null;
  }
  const statsSocketLevels = statsSocketLevelSet(ctx.schema);
  const diagnostics: vscode.Diagnostic[] = [];
  for (let i = 2; i < line.tokens.length; i += 1) {
    const val = normalizedOptionToken(line.tokens[i].text);
    if (val === "level" && i + 1 < line.tokens.length) {
      const levelValue = lowerToken(line.tokens[i + 1].text);
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

function matchesNestedKeywordSkipPattern(
  schema: HaproxySchema,
  tokens: ParsedLine["tokens"],
): boolean {
  const patterns = validationObjectArray<{ match_tokens?: string[] }>(
    schema,
    "nested_keyword_skip_patterns",
  );
  for (const pattern of patterns) {
    const matchTokens = pattern.match_tokens ?? [];
    if (
      matchTokens.length > 0 &&
      matchTokens.every((token, index) => tokens[index]?.text.toLowerCase() === token)
    ) {
      return true;
    }
  }
  return false;
}

function handleTcpInspectDelayLine(
  ctx: DiagnosticContext,
  line: ParsedLine,
): vscode.Diagnostic[] | null {
  if (matchesNestedKeywordSkipPattern(ctx.schema, line.tokens)) {
    return [];
  }
  return null;
}

const NESTED_KEYWORD_HANDLERS: NestedKeywordHandler[] = [
  handleOptionLine,
  handleSkippedKeywordLine,
  handleAclLine,
  handleStatsSocketLine,
  handleTcpInspectDelayLine,
];

export function unknownNestedDiagnostics(
  ctx: DiagnosticContext,
  line: ParsedLine,
): vscode.Diagnostic[] {
  const t0 = lowerToken(line.tokens[0]?.text ?? "");
  if (!t0 || !nestedDiagnosticKeywordSet(ctx.schema).has(t0)) {
    return [];
  }

  for (const handler of NESTED_KEYWORD_HANDLERS) {
    const result = handler(ctx, line);
    if (result !== null) {
      return result;
    }
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const { statementRule: rule } = ctx.getLineMemo(line);

  const phaseIdx = resolvePhaseTokenIndex(rule, line);
  if (phaseIdx !== null && (t0 === "tcp-request" || t0 === "tcp-response")) {
    const phases =
      t0 === "tcp-request" ? tcpRequestPhaseSet(ctx.schema) : tcpResponsePhaseSet(ctx.schema);
    const phase = lowerToken(line.tokens[phaseIdx].text);
    if (!phases.has(phase)) {
      const groupName = ruleActionGroup(rule);
      const allowed = groupName ? keywordGroupSet(ctx.schema, groupName) : new Set<string>();
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
    const allowed = groupName ? keywordGroupSet(ctx.schema, groupName) : new Set<string>();
    const dynamicPrefixes = dynamicActionPrefixes(ctx.schema);
    const hasDynamicPrefix = dynamicPrefixes.some((prefix) => token.startsWith(prefix));
    if (token && !hasDynamicPrefix && !allowed.has(token)) {
      diagnostics.push(
        makeDiagnostic(
          diagRange(line, actionIdx),
          `Unknown ${line.tokens[0].text} action '${rawToken}'`,
          vscode.DiagnosticSeverity.Warning,
          "unknown-action",
        ),
      );
    } else if (token === useServiceAction(ctx.schema) && actionIdx + 1 < line.tokens.length) {
      const serviceIdx = actionIdx + 1;
      const serviceName = lowerToken(line.tokens[serviceIdx].text);
      const services = keywordGroupSet(ctx.schema, "services");
      if (
        services.size > 0 &&
        serviceName &&
        !dynamicPrefixes.some((prefix) => serviceName.startsWith(prefix)) &&
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

function useServiceAction(schema: HaproxySchema): string {
  const rule = semanticRecord(schema, "use_service");
  if (typeof rule.action !== "string") {
    throw new Error(
      "HAProxy schema is missing required generated metadata: semantic_groups.use_service.action",
    );
  }
  return rule.action;
}
