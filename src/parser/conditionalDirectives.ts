/** Lookup helpers and branch tracking for conditional preprocessor directives. */
import { ParsedLine } from "./index";
import { HaproxyLanguageData } from "../language/languageData";
import { HaproxySchema } from "../schema/types";
import { macroTokenSet } from "../schema/tokens";
import type { HaproxyVersion } from "../extension/version";

export interface ConditionalDirectiveInfo {
  name: string;
  signature: string;
  description: string;
  docsChapter?: string;
}

/** Whether a line's conditional branch is active, inactive, or unknown at edit time. */
export type ConditionalBranchState = "active" | "inactive" | "unknown";

export interface ConditionalLineInfo {
  nestDepth: number;
  branchState: ConditionalBranchState;
  effectiveSection: string | null;
}

const CONDITIONAL_BLOCK_DIRECTIVES = new Set([".if", ".elif", ".else", ".endif"]);

type PredicateResult = true | false | "unknown";

interface ConditionalFrame {
  currentActive: boolean;
  branchTaken: boolean;
  unknown: boolean;
}

export function lookupConditionalDirective(
  data: HaproxyLanguageData,
  token: string,
): ConditionalDirectiveInfo | undefined {
  const directives = data.conditionalDirectives ?? [];
  return directives.find((entry) => entry.name.toLowerCase() === token.toLowerCase());
}

export function conditionalBlocksDocsUrl(
  data: HaproxyLanguageData,
  version: HaproxyVersion,
): string {
  const chapter = data.conditionalDirectives?.[0]?.docsChapter ?? "2.4";
  return `https://docs.haproxy.org/${version}/configuration.html#${chapter}`;
}

export function isConditionalOrStatusDirective(
  schema: HaproxySchema,
  token: string | undefined,
): boolean {
  if (!token) {
    return false;
  }
  return macroTokenSet(schema).has(token.toLowerCase());
}

export function isConditionalBlockDirective(token: string | undefined): boolean {
  if (!token) {
    return false;
  }
  return CONDITIONAL_BLOCK_DIRECTIVES.has(token.toLowerCase());
}

export function isInactiveConditionalBranch(state: ConditionalBranchState): boolean {
  return state === "inactive";
}

function predicateTextFromLine(line: ParsedLine): string {
  if (line.tokens.length <= 1) {
    return "";
  }
  return line.tokens
    .slice(1)
    .map((token) => token.text)
    .join(" ")
    .trim();
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isQuotedLiteral(value: string): boolean {
  return (
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  );
}

function evaluatePredicate(text: string): PredicateResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return "unknown";
  }

  let negate = false;
  let expr = trimmed;
  if (expr.startsWith("!")) {
    negate = true;
    expr = expr.slice(1).trim();
  }

  let result: PredicateResult;
  const lower = expr.toLowerCase();
  if (lower === "true") {
    result = true;
  } else if (lower === "false") {
    result = false;
  } else if (lower.startsWith("defined(")) {
    result = "unknown";
  } else {
    const streqMatch = /^streq\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)$/i.exec(expr);
    if (streqMatch) {
      const leftRaw = streqMatch[1].trim();
      const rightRaw = streqMatch[2].trim();
      const left = stripQuotes(leftRaw);
      const right = stripQuotes(rightRaw);
      if (left === right) {
        result = true;
      } else if (
        (isQuotedLiteral(leftRaw) && isQuotedLiteral(rightRaw)) ||
        (/^-?\d+$/.test(left) && /^-?\d+$/.test(right))
      ) {
        result = false;
      } else {
        result = "unknown";
      }
    } else {
      result = "unknown";
    }
  }

  if (result === "unknown") {
    return "unknown";
  }
  return negate ? !result : result;
}

function branchStateFromStack(stack: ConditionalFrame[]): ConditionalBranchState {
  for (const frame of stack) {
    if (!frame.unknown && !frame.currentActive) {
      return "inactive";
    }
  }
  for (const frame of stack) {
    if (frame.unknown) {
      return "unknown";
    }
  }
  return "active";
}

function frameFromPredicate(result: PredicateResult): ConditionalFrame {
  if (result === "unknown") {
    return { currentActive: true, branchTaken: false, unknown: true };
  }
  return { currentActive: result, branchTaken: result, unknown: false };
}

function handleIfDirective(stack: ConditionalFrame[], line: ParsedLine): void {
  stack.push(frameFromPredicate(evaluatePredicate(predicateTextFromLine(line))));
}

function handleElifDirective(stack: ConditionalFrame[], line: ParsedLine): void {
  const frame = stack[stack.length - 1];
  if (!frame) {
    return;
  }
  if (frame.unknown) {
    stack[stack.length - 1] = { currentActive: true, branchTaken: false, unknown: true };
    return;
  }
  if (frame.branchTaken) {
    stack[stack.length - 1] = { ...frame, currentActive: false };
    return;
  }
  const next = frameFromPredicate(evaluatePredicate(predicateTextFromLine(line)));
  stack[stack.length - 1] = next;
}

function handleElseDirective(stack: ConditionalFrame[]): void {
  const frame = stack[stack.length - 1];
  if (!frame) {
    return;
  }
  if (frame.unknown) {
    stack[stack.length - 1] = { currentActive: true, branchTaken: false, unknown: true };
    return;
  }
  stack[stack.length - 1] = {
    currentActive: !frame.branchTaken,
    branchTaken: true,
    unknown: false,
  };
}

/** Maps each parsed line to conditional nest depth and branch activity. */
export function conditionalBranchInfoForDocument(parsed: ParsedLine[]): ConditionalLineInfo[] {
  const info: ConditionalLineInfo[] = Array.from({ length: parsed.length }, () => ({
    nestDepth: 0,
    branchState: "active",
    effectiveSection: null,
  }));
  const stack: ConditionalFrame[] = [];
  let effectiveSection: string | null = null;

  for (const line of parsed) {
    const branchState = branchStateFromStack(stack);
    if (line.isSectionHeader && branchState !== "inactive") {
      effectiveSection = line.tokens[0]?.text.toLowerCase() ?? effectiveSection;
    }
    info[line.line] = {
      nestDepth: stack.length,
      branchState,
      effectiveSection,
    };

    const directive = line.tokens[0]?.text.toLowerCase();
    if (directive === ".if") {
      handleIfDirective(stack, line);
      continue;
    }
    if (directive === ".elif") {
      handleElifDirective(stack, line);
      continue;
    }
    if (directive === ".else") {
      handleElseDirective(stack);
      continue;
    }
    if (directive === ".endif") {
      stack.pop();
    }
  }

  return info;
}
