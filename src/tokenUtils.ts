import { ParsedLine, ParsedToken } from "./parser";

export const PREFIX_FAMILIES = ["stats", "timeout", "tcp-check", "http-check", "capture", "tcp-request", "tcp-response"];

export function isWordToken(token: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(token);
}

export function isDirectivePart(token: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(token);
}

export function isNumberToken(token: string): boolean {
  return /^[0-9]+(?:\.[0-9]+)?(?:[kmgt]?s|ms|m|h|d|k|%)?$/i.test(token);
}

export function isLikelyValue(token: string, conditionals?: Set<string>): boolean {
  if (!token) {
    return true;
  }
  if (token.startsWith("<") && token.endsWith(">")) {
    return true;
  }
  if (token.startsWith('"') || token.startsWith("'")) {
    return true;
  }
  if (token.startsWith("{") || token.startsWith("%[") || token.startsWith("(")) {
    return true;
  }
  if (/^[0-9]/.test(token)) {
    return true;
  }
  if (token.includes(":") || token.includes("/") || token.includes("=")) {
    return true;
  }
  if (token.includes(".") && !isDirectivePart(token)) {
    return true;
  }
  if (conditionals?.has(token.toLowerCase())) {
    return true;
  }
  return false;
}

export function isAddressOrPathToken(token: string): boolean {
  if (token.startsWith('"') || token.startsWith("'")) {
    return true;
  }
  return token.includes(":") || token.includes("/") || token.includes(".") || token.startsWith(":");
}

export interface DirectiveMatch {
  start: number;
  end: number;
  keyword: string;
  matched: boolean;
}

export function joinTokens(tokens: ParsedToken[], start: number, end: number): string {
  return tokens
    .slice(start, end + 1)
    .map((t) => t.text.toLowerCase())
    .join(" ");
}

export function resolveLongestDirectiveMatch(
  line: ParsedLine,
  allowed: Set<string>,
  maxParts = 4,
  noPrefixKeywords?: Set<string>,
  modifierPrefixes?: Set<string>
): DirectiveMatch {
  const tokens = line.tokens;
  if (tokens.length === 0) {
    return { start: 0, end: -1, keyword: "", matched: false };
  }

  if (
    modifierPrefixes &&
    tokens.length >= 2 &&
    modifierPrefixes.has(tokens[0].text.toLowerCase())
  ) {
    const inner = resolveLongestDirectiveMatch(
      { ...line, tokens: tokens.slice(1) },
      allowed,
      maxParts,
      undefined,
      modifierPrefixes
    );
    if (inner.matched && noPrefixKeywords?.has(inner.keyword)) {
      return {
        start: 0,
        end: inner.end + 1,
        keyword: inner.keyword,
        matched: true,
      };
    }
  }

  const limit = Math.min(tokens.length, maxParts);
  for (let end = limit - 1; end >= 0; end -= 1) {
    const keyword = joinTokens(tokens, 0, end);
    const hyphen = tokens
      .slice(0, end + 1)
      .map((t) => t.text.toLowerCase())
      .join("-");
    if (allowed.has(keyword) || (end === 1 && allowed.has(hyphen))) {
      return { start: 0, end, keyword: allowed.has(keyword) ? keyword : hyphen, matched: true };
    }
  }

  return resolveAttemptedDirectiveSpan(line, maxParts);
}

export function resolveAttemptedDirectiveSpan(
  line: ParsedLine,
  maxParts = 4,
  conditionals?: Set<string>
): DirectiveMatch {
  const tokens = line.tokens;
  if (tokens.length === 0) {
    return { start: 0, end: -1, keyword: "", matched: false };
  }

  let end = 0;
  while (end < tokens.length && end < maxParts) {
    const text = tokens[end].text;
    if (end > 0 && isLikelyValue(text, conditionals)) {
      break;
    }
    if (!isDirectivePart(text)) {
      break;
    }
    end += 1;
  }

  if (end === 0) {
    end = 1;
  } else {
    end -= 1;
  }

  return {
    start: 0,
    end,
    keyword: joinTokens(tokens, 0, end),
    matched: false,
  };
}

export function resolveSubcommandSpan(
  line: ParsedLine,
  allowed: Set<string>,
  prefix: string
): { start: number; end: number; subcommand: string; matched: boolean } | null {
  const prefixLower = prefix.toLowerCase();
  if (line.tokens[0]?.text.toLowerCase() !== prefixLower || line.tokens.length < 2) {
    return null;
  }

  const subcommands = new Set<string>();
  const needle = `${prefixLower} `;
  for (const keyword of allowed) {
    if (keyword.startsWith(needle)) {
      subcommands.add(keyword.slice(needle.length));
    }
  }
  if (subcommands.size === 0) {
    return null;
  }

  for (let end = Math.min(line.tokens.length - 1, 3); end >= 1; end -= 1) {
    const sub = joinTokens(line.tokens, 1, end);
    if (subcommands.has(sub)) {
      return { start: 1, end, subcommand: sub, matched: true };
    }
  }

  let end = 1;
  while (end < line.tokens.length && end < 4 && isDirectivePart(line.tokens[end].text)) {
    end += 1;
  }
  end = Math.max(1, end - 1);
  return {
    start: 1,
    end,
    subcommand: joinTokens(line.tokens, 1, end),
    matched: false,
  };
}

export function resolveDirectiveSpan(line: ParsedLine, allowed: Set<string>): { start: number; end: number } {
  const match = resolveLongestDirectiveMatch(line, allowed);
  return { start: match.start, end: match.end };
}

/** Rule action name from a config token (e.g. set-var(txn.path) -> set-var). */
export function normalizeActionName(token: string): string {
  const lower = token.toLowerCase().replace(/\*$/, "");
  const paren = lower.indexOf("(");
  if (paren > 0 && lower.endsWith(")")) {
    return lower.slice(0, paren);
  }
  return lower;
}

export function actionTokenIndex(line: ParsedLine): number | null {
  const tokens = line.tokens;
  if (tokens.length < 2) {
    return null;
  }
  const t0 = tokens[0].text.toLowerCase();
  if (t0 === "http-request" || t0 === "http-response" || t0 === "http-after-response") {
    return 1;
  }
  if (t0 === "tcp-request" || t0 === "tcp-response") {
    if (tokens.length >= 3) {
      const t1 = tokens[1].text.toLowerCase();
      if (t1 === "connection" || t1 === "session" || t1 === "content") {
        return 2;
      }
    }
    return 1;
  }
  return null;
}

export function tcpPhaseIndex(line: ParsedLine, phases: Set<string>): number | null {
  const t0 = line.tokens[0]?.text.toLowerCase();
  if (t0 !== "tcp-request" && t0 !== "tcp-response") {
    return null;
  }
  if (line.tokens.length >= 2) {
    const t1 = line.tokens[1].text.toLowerCase();
    if (phases.has(t1)) {
      return 1;
    }
  }
  return null;
}
