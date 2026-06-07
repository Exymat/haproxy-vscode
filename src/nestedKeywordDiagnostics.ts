import * as vscode from "vscode";

import { DiagnosticContext } from "./diagnosticContext";
import { diagRange, diagRangeForTokens, makeDiagnostic } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import {
  conditionalTokenSet,
  HaproxySchema,
  prefixFamilies,
  prefixSubcommandSet,
  statsSocketLevelSet,
  tcpRequestPhaseSet,
  tcpResponsePhaseSet,
} from "./schema";
import {
  resolveActionTokenIndex,
  resolvePhaseTokenIndex,
  ruleActionGroup,
} from "./statementLayout";
import { RuntimeMode } from "./sectionMode";
import { isLikelyValue, normalizeActionName, resolveSubcommandSpan } from "./tokenUtils";

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

function wrongContextMessage(keyword: string, mode: RuntimeMode, contexts: string[]): string {
  return `'${keyword}' is not supported in mode '${mode}' (allowed in: ${contexts.join(", ")})`;
}

function modeContextDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  keyword: string,
  contexts: string[],
  mode: RuntimeMode | null,
): vscode.Diagnostic | null {
  if (!mode || contexts.length === 0) {
    /* c8 ignore next -- contextDiagnostics callers already guarantee both mode and non-empty contexts */
    return null;
  }
  const normalized = contexts.map((c) => c.toLowerCase());
  const modeSet = ["tcp", "http", "log"];
  if (!normalized.some((ctx) => modeSet.includes(ctx))) {
    return null;
  }
  if (normalized.includes(mode)) {
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
  const { allowed, directiveMatch: match } = ctx.getLineMemo(line);
  if (match.matched) {
    return [];
  }

  if (isOptionLine(line) && optionAllowedInSection(allowed)) {
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

  const prefix = line.tokens[0]?.text.toLowerCase();
  if (prefix && prefixFamilies(ctx.schema).includes(prefix)) {
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
  const t0 = line.tokens[0]?.text.toLowerCase();
  const t1 = line.tokens[1]?.text.toLowerCase();

  if (top.matched) {
    const kw = ctx.schema.keywords[top.keyword.toLowerCase()];
    if (kw?.contexts?.length) {
      const diag = modeContextDiagnostic(line, top.start, kw.name, kw.contexts, mode);
      if (diag) {
        diagnostics.push(diag);
      }
    }
  }

  if (t0 === "option" || (t0 === "no" && t1 === "option")) {
    const idx = t0 === "option" ? 1 : 2;
    const option = line.tokens[idx]?.text.toLowerCase();
    if (option) {
      const contexts = ctx.schema.keyword_group_contexts?.options?.[option];
      if (contexts?.length) {
        const diag = modeContextDiagnostic(line, idx, `option ${option}`, contexts, mode);
        if (diag) {
          diagnostics.push(diag);
        }
      }
    }
  }

  if (t0 === "bind" || t0 === "server" || t0 === "default-server") {
    const groupName = rule?.group;
    const start = rule?.nested_start_index ?? -1;
    if (groupName && start >= 0) {
      const groupContexts = ctx.schema.keyword_group_contexts?.[groupName] ?? {};
      const allowedGroup = new Set(
        (ctx.schema.keyword_groups[groupName] ?? []).map((v) => v.toLowerCase()),
      );
      const condStart = line.tokens.findIndex((tok) =>
        conditionalTokenSet(ctx.schema).has(tok.text.toLowerCase()),
      );
      const limit = condStart >= 0 ? condStart : line.tokens.length;
      for (let i = start; i < limit; i += 1) {
        const option = line.tokens[i].text.toLowerCase().replace(/\*$/, "");
        if (!allowedGroup.has(option)) {
          continue;
        }
        const contexts = groupContexts[option];
        if (!contexts?.length) {
          continue;
        }
        const diag = modeContextDiagnostic(line, i, option, contexts, mode);
        if (diag) {
          diagnostics.push(diag);
        }
      }
    }
  }

  return diagnostics;
}

export function unknownNestedDiagnostics(
  ctx: DiagnosticContext,
  line: ParsedLine,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const groups = ctx.schema.keyword_groups;
  const conditionals = conditionalTokenSet(ctx.schema);
  const statsSocketLevels = statsSocketLevelSet(ctx.schema);
  const { statementRule: rule } = ctx.getLineMemo(line);
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

  if (
    (t0 === "tcp-request" || t0 === "tcp-response") &&
    line.tokens[1]?.text.toLowerCase() === "inspect-delay"
  ) {
    return diagnostics;
  }

  const phaseIdx = resolvePhaseTokenIndex(rule, line);
  if (phaseIdx !== null && (t0 === "tcp-request" || t0 === "tcp-response")) {
    const phases =
      t0 === "tcp-request" ? tcpRequestPhaseSet(ctx.schema) : tcpResponsePhaseSet(ctx.schema);
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
