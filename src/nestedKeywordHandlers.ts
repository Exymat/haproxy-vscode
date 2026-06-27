import * as vscode from "vscode";

import { DiagnosticContext } from "./diagnosticContext";
import { diagRange, makeDiagnostic } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import {
  conditionalTokenSet,
  keywordGroupSet,
  statsSocketLevelSet,
  tcpRequestPhaseSet,
  tcpResponsePhaseSet,
} from "./schema";
import {
  resolveActionTokenIndex,
  resolvePhaseTokenIndex,
  ruleActionGroup,
} from "./statementLayout";
import { isLikelyValue, normalizeActionName } from "./tokenUtils";

const NESTED_DIAGNOSTIC_KEYWORDS = new Set([
  "option",
  "no",
  "acl",
  "stats",
  "tcp-request",
  "tcp-response",
  "http-request",
  "http-response",
  "http-after-response",
  "mode",
  "balance",
  "bind",
  "server",
]);

type NestedKeywordHandler = (
  ctx: DiagnosticContext,
  line: ParsedLine,
) => vscode.Diagnostic[] | null;

function handleOptionLine(ctx: DiagnosticContext, line: ParsedLine): vscode.Diagnostic[] | null {
  const t0 = line.tokens[0]?.text.toLowerCase();
  const t1 = line.tokens[1]?.text.toLowerCase();
  if (t0 !== "option" && !(t0 === "no" && t1 === "option")) {
    return null;
  }
  const idx = t0 === "option" ? 1 : 2;
  const value = line.tokens[idx]?.text.toLowerCase();
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
  _ctx: DiagnosticContext,
  line: ParsedLine,
): vscode.Diagnostic[] | null {
  const t0 = line.tokens[0]?.text.toLowerCase();
  if (t0 === "mode" || t0 === "balance" || t0 === "bind" || t0 === "server") {
    return [];
  }
  return null;
}

function handleAclLine(ctx: DiagnosticContext, line: ParsedLine): vscode.Diagnostic[] | null {
  const t0 = line.tokens[0]?.text.toLowerCase();
  if (t0 !== "acl" || line.tokens.length < 3) {
    return null;
  }
  const conditionals = conditionalTokenSet(ctx.schema);
  const rawCriterion = line.tokens[2].text;
  const parenIdx = rawCriterion.indexOf("(");
  const criterion = (parenIdx >= 0 ? rawCriterion.slice(0, parenIdx) : rawCriterion).toLowerCase();
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
  const t0 = line.tokens[0]?.text.toLowerCase();
  const t1 = line.tokens[1]?.text.toLowerCase();
  if (t0 !== "stats" || t1 !== "socket") {
    return null;
  }
  const statsSocketLevels = statsSocketLevelSet(ctx.schema);
  const diagnostics: vscode.Diagnostic[] = [];
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

function handleTcpInspectDelayLine(
  _ctx: DiagnosticContext,
  line: ParsedLine,
): vscode.Diagnostic[] | null {
  const t0 = line.tokens[0]?.text.toLowerCase();
  if (
    (t0 === "tcp-request" || t0 === "tcp-response") &&
    line.tokens[1]?.text.toLowerCase() === "inspect-delay"
  ) {
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
  const t0 = line.tokens[0]?.text.toLowerCase();
  if (!t0 || !NESTED_DIAGNOSTIC_KEYWORDS.has(t0)) {
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
    const phase = line.tokens[phaseIdx].text.toLowerCase();
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
      const services = keywordGroupSet(ctx.schema, "services");
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
