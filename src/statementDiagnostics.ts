import * as vscode from "vscode";

import {
  ADDRESS_POLICIES,
  AddressPolicyName,
  AddressValidationResult,
  isServerMainAddressPlaceholder,
  PortAddressPolicy,
  validateHaproxyAddress,
} from "./addressFormat";
import { conditionalStartIndex } from "./directiveUtils";
import { ParsedLine } from "./parser";
import { FixedSlotSpec, HaproxySchema, StatementRule } from "./schema";
import { BIND_OPTIONS_WITH_VALUE, SERVER_OPTIONS_WITH_VALUE } from "./tokenUtils";

const DIAG_SOURCE = "haproxy";

type StmtDiagCode =
  | "invalid-address"
  | "missing-port"
  | "port-not-permitted"
  | "port-range-not-permitted"
  | "port-offset-not-permitted"
  | "invalid-port"
  | "missing-argument"
  | "unexpected-argument"
  | "unknown-parameter"
  | "reserved-name";

const SERVER_ADDRESS_OPTION_POLICIES: Record<string, AddressPolicyName> = {
  source: "serverSource",
  usesrc: "serverUsesrc",
  socks4: "serverSocks4",
};

function diagRange(line: ParsedLine, tokenIndex: number): vscode.Range {
  const tok = line.tokens[tokenIndex];
  return new vscode.Range(line.line, tok.start, line.line, tok.end);
}

function makeDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  message: string,
  code: StmtDiagCode,
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(diagRange(line, tokenIndex), message, severity);
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = code;
  return diagnostic;
}

function pushAddressResult(
  line: ParsedLine,
  tokenIndex: number,
  result: AddressValidationResult,
  diagnostics: vscode.Diagnostic[]
): void {
  if (result.valid || !result.message) {
    return;
  }
  const code = (result.code ?? "invalid-address") as StmtDiagCode;
  diagnostics.push(makeDiagnostic(line, tokenIndex, result.message, code));
}

function findStatementRule(schema: HaproxySchema, line: ParsedLine): StatementRule | undefined {
  const t0 = line.tokens[0]?.text.toLowerCase();
  if (!t0) {
    return undefined;
  }
  const t1 = line.tokens[1]?.text.toLowerCase();
  for (const rule of schema.statement_rules) {
    if (rule.prefix === "no" && t0 === "no") {
      continue;
    }
    if (rule.prefix && rule.prefix !== t0) {
      continue;
    }
    if (rule.keyword.toLowerCase() === t0) {
      return rule;
    }
    if (rule.prefix && `${rule.prefix} ${rule.keyword}`.toLowerCase() === `${t0} ${t1}`) {
      return rule;
    }
  }
  return undefined;
}

function policyForSlot(rule: StatementRule, spec: FixedSlotSpec, token: string): PortAddressPolicy {
  if (rule.kind === "bind") {
    return token.startsWith("/") ? { ...ADDRESS_POLICIES.bind, portMandatory: false } : ADDRESS_POLICIES.bind;
  }
  if (rule.kind === "server" && spec.role === "address") {
    return ADDRESS_POLICIES.server;
  }
  if (rule.kind === "log" || rule.keyword === "log") {
    return ADDRESS_POLICIES.log;
  }
  if (rule.keyword === "source") {
    return ADDRESS_POLICIES.source;
  }
  return ADDRESS_POLICIES.server;
}

function validateFixedSlots(line: ParsedLine, rule: StatementRule): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const slots = rule.fixed_slots ?? [];
  if (slots.length === 0) {
    return diagnostics;
  }

  const nestedStart = rule.nested_start_index ?? 1 + slots.length;
  const condStart = conditionalStartIndex(line, 0);
  const limit = Math.min(condStart, nestedStart);

  for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
    const tokenIdx = 1 + slotIdx;
    if (tokenIdx >= limit) {
      diagnostics.push(
        makeDiagnostic(
          line,
          Math.max(1, line.tokens.length - 1),
          `'${rule.keyword}' is missing required argument`,
          "missing-argument"
        )
      );
      break;
    }

    const token = line.tokens[tokenIdx].text;
    const spec = slots[slotIdx];

    if (spec.role === "name") {
      const lower = token.toLowerCase();
      if (lower === "check" || lower === "inter") {
        diagnostics.push(
          makeDiagnostic(
            line,
            tokenIdx,
            `'${token}' is a server parameter name, not a server name`,
            "reserved-name",
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
      continue;
    }

    if (spec.role === "address") {
      if (rule.kind === "server" && isServerMainAddressPlaceholder(token)) {
        continue;
      }
      const policy = policyForSlot(rule, spec, token);
      pushAddressResult(line, tokenIdx, validateHaproxyAddress(token, policy), diagnostics);
    }
  }

  return diagnostics;
}

function optionValuePolicy(rule: StatementRule, option: string): PortAddressPolicy | null {
  const lower = option.toLowerCase();
  if (rule.kind === "server") {
    const named = SERVER_ADDRESS_OPTION_POLICIES[lower];
    if (named) {
      return ADDRESS_POLICIES[named];
    }
    if (SERVER_OPTIONS_WITH_VALUE.has(lower)) {
      return null;
    }
  }
  if (rule.kind === "bind" && BIND_OPTIONS_WITH_VALUE.has(lower)) {
    return null;
  }
  return null;
}

function scanNestedOptions(
  line: ParsedLine,
  rule: StatementRule,
  schema: HaproxySchema
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const nestedStart = rule.nested_start_index ?? line.tokens.length;
  const groupName = rule.group;
  if (!groupName) {
    return diagnostics;
  }

  const allowed = new Set((schema.keyword_groups[groupName] ?? []).map((v) => v.toLowerCase()));
  const condStart = conditionalStartIndex(line, 0);
  let i = nestedStart;

  while (i < condStart) {
    const raw = line.tokens[i].text;
    const opt = raw.toLowerCase().replace(/\*$/, "");
    if (!opt) {
      i += 1;
      continue;
    }

    if (allowed.has(opt)) {
      const addrPolicy = optionValuePolicy(rule, opt);
      if (addrPolicy && i + 1 < condStart) {
        pushAddressResult(line, i + 1, validateHaproxyAddress(line.tokens[i + 1].text, addrPolicy), diagnostics);
        i += 2;
        continue;
      }

      const takesValue =
        rule.kind === "server"
          ? SERVER_OPTIONS_WITH_VALUE.has(opt)
          : rule.kind === "bind"
            ? BIND_OPTIONS_WITH_VALUE.has(opt)
            : false;

      if (takesValue && i + 1 < condStart) {
        const next = line.tokens[i + 1].text.toLowerCase();
        if (!allowed.has(next.replace(/\*$/, ""))) {
          i += 2;
          continue;
        }
      }
      i += 1;
      continue;
    }

    if (/^[0-9]/.test(opt) || /^[0-9].*s$/i.test(opt)) {
      i += 1;
      continue;
    }

    diagnostics.push(
      makeDiagnostic(
        line,
        i,
        `Unknown ${rule.keyword} parameter '${raw}'`,
        "unknown-parameter",
        vscode.DiagnosticSeverity.Warning
      )
    );
    i += 1;
  }

  return diagnostics;
}

const LOG_ADDRESS_SKIP = new Set(["global", "stdout", "stderr"]);

function logLineDiagnostics(line: ParsedLine): vscode.Diagnostic[] {
  if (line.tokens[0]?.text.toLowerCase() !== "log" || line.tokens.length < 2) {
    return [];
  }
  const target = line.tokens[1].text;
  const lower = target.toLowerCase();
  if (LOG_ADDRESS_SKIP.has(lower) || lower.startsWith("@") || target.startsWith("/")) {
    return [];
  }
  const diagnostics: vscode.Diagnostic[] = [];
  pushAddressResult(line, 1, validateHaproxyAddress(target, ADDRESS_POLICIES.log), diagnostics);
  return diagnostics;
}

function sourceLineDiagnostics(line: ParsedLine): vscode.Diagnostic[] {
  if (line.tokens[0]?.text.toLowerCase() !== "source" || line.tokens.length < 2) {
    return [];
  }
  const diagnostics: vscode.Diagnostic[] = [];
  pushAddressResult(line, 1, validateHaproxyAddress(line.tokens[1].text, ADDRESS_POLICIES.source), diagnostics);
  return diagnostics;
}

function tcpCheckLineDiagnostics(line: ParsedLine): vscode.Diagnostic[] {
  const t0 = line.tokens[0]?.text.toLowerCase();
  if (t0 !== "tcp-check" && t0 !== "http-check") {
    return [];
  }
  const diagnostics: vscode.Diagnostic[] = [];
  for (let i = 1; i < line.tokens.length - 1; i += 1) {
    if (line.tokens[i].text.toLowerCase() === "addr") {
      pushAddressResult(
        line,
        i + 1,
        validateHaproxyAddress(line.tokens[i + 1].text, ADDRESS_POLICIES.tcpCheckAddr),
        diagnostics
      );
    }
  }
  return diagnostics;
}

export function statementDiagnostics(line: ParsedLine, schema: HaproxySchema): vscode.Diagnostic[] {
  const t0 = line.tokens[0]?.text.toLowerCase() ?? "";

  if (t0 === "log") {
    return logLineDiagnostics(line);
  }
  if (t0 === "source") {
    return sourceLineDiagnostics(line);
  }
  if (t0 === "tcp-check" || t0 === "http-check") {
    return tcpCheckLineDiagnostics(line);
  }

  const rule = findStatementRule(schema, line);
  if (!rule?.fixed_slots?.length) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  diagnostics.push(...validateFixedSlots(line, rule));
  diagnostics.push(...scanNestedOptions(line, rule, schema));
  return diagnostics;
}
