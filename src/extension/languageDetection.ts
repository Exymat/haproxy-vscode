/** Decides whether plaintext looks like a HAProxy config from section grammar. */
import { ParsedToken, tokenizeLine } from "../parser";

const MAX_LEADING_LINES = 200;
const MAX_WITNESS_LINES = 40;

const PREAMBLE_DIRECTIVES = new Set([
  ".if",
  ".elif",
  ".else",
  ".endif",
  ".diag",
  ".notice",
  ".warning",
  ".alert",
]);

/** Union of section headers across bundled community and HAPEE schemas. */
const SECTION_KEYWORDS = new Set([
  "global",
  "defaults",
  "frontend",
  "backend",
  "listen",
  "peers",
  "userlist",
  "resolvers",
  "mailers",
  "program",
  "healthcheck",
  "http-errors",
  "ring",
  "cache",
  "crt-list",
  "crt-store",
  "traces",
  "acme",
  "log-forward",
  "log-profile",
  "botmgmt-profile",
  "captcha",
  "fcgi-app",
  "oidc-sso",
  "rhi-bgp",
  "udp-lb",
  "waf-global",
  "waf-profile",
]);

const DIRECTIVE_WITNESSES = new Set([
  "bind",
  "peer",
  "use_backend",
  "default_backend",
  "default-server",
  "http-request",
  "http-response",
  "tcp-request",
  "tcp-response",
  "stick-table",
  "acl",
  "timeout",
  "balance",
  "option",
  "maxconn",
  "nbthread",
  "nbproc",
  "daemon",
  "cpu-map",
  "chroot",
  "pidfile",
  "stats",
  "setenv",
  "presetenv",
  "errorfile",
]);

interface SectionMatch {
  distinctive: boolean;
}

function lineHasBrace(line: string): boolean {
  return line.includes("{") || line.includes("}");
}

function tokenText(token: ParsedToken): string {
  return token.text.toLowerCase();
}

function isDistinctiveKeyword(keyword: string): boolean {
  return keyword === "frontend" || keyword === "backend" || keyword.includes("-");
}

function isPreamble(tokens: ParsedToken[]): boolean {
  return tokens.length > 0 && PREAMBLE_DIRECTIVES.has(tokenText(tokens[0]));
}

function defaultsArgumentsMatch(args: ParsedToken[]): boolean {
  if (args.length === 0) {
    return true;
  }
  if (args.length === 1) {
    return tokenText(args[0]) !== "from";
  }
  if (args.length === 2) {
    return tokenText(args[0]) === "from";
  }
  return args.length === 3 && tokenText(args[0]) !== "from" && tokenText(args[1]) === "from";
}

function namedArgumentsMatch(args: ParsedToken[]): boolean {
  if (args.length === 1) {
    return tokenText(args[0]) !== "from";
  }
  return args.length === 3 && tokenText(args[0]) !== "from" && tokenText(args[1]) === "from";
}

function sectionArgumentsMatch(keyword: string, tokens: ParsedToken[]): boolean {
  const args = tokens.slice(1);
  if (keyword === "global") {
    return args.length === 0;
  }
  if (keyword === "defaults") {
    return defaultsArgumentsMatch(args);
  }
  return namedArgumentsMatch(args);
}

function matchSection(line: string, tokens: ParsedToken[]): SectionMatch | null {
  if (tokens.length === 0 || tokens[0].start !== 0 || lineHasBrace(line)) {
    return null;
  }
  const keyword = tokenText(tokens[0]);
  if (!SECTION_KEYWORDS.has(keyword) || !sectionArgumentsMatch(keyword, tokens)) {
    return null;
  }
  return { distinctive: isDistinctiveKeyword(keyword) };
}

function looksLikeServerAddress(token: string): boolean {
  return token.toLowerCase() === "localhost" || /[:./@]/.test(token) || /^\d/.test(token);
}

function isModeWitness(tokens: ParsedToken[]): boolean {
  const mode = tokens[1] ? tokenText(tokens[1]) : "";
  return mode === "http" || mode === "tcp" || mode === "log";
}

function isServerWitness(tokens: ParsedToken[]): boolean {
  const address = tokens[2]?.text;
  return address !== undefined && looksLikeServerAddress(address);
}

function isIndentedDirectiveWitness(tokens: ParsedToken[]): boolean {
  const keyword = tokenText(tokens[0]);
  if (keyword === "mode") {
    return isModeWitness(tokens);
  }
  if (keyword === "server") {
    return isServerWitness(tokens);
  }
  if (keyword.startsWith("tune.") || keyword.startsWith("ssl-default-")) {
    return true;
  }
  return DIRECTIVE_WITNESSES.has(keyword);
}

function isWitnessLine(line: string, tokens: ParsedToken[]): boolean {
  if (tokens.length === 0 || lineHasBrace(line)) {
    return false;
  }
  if (tokens[0].start === 0) {
    return matchSection(line, tokens) !== null;
  }
  return isIndentedDirectiveWitness(tokens);
}

function findSectionCandidate(
  lines: readonly string[],
): { index: number; match: SectionMatch } | null {
  const limit = Math.min(lines.length, MAX_LEADING_LINES);
  for (let index = 0; index < limit; index += 1) {
    const line = lines[index] ?? "";
    const tokens = tokenizeLine(line);
    if (tokens.length === 0 || isPreamble(tokens)) {
      continue;
    }
    const match = matchSection(line, tokens);
    if (!match) {
      return null;
    }
    return { index, match };
  }
  return null;
}

function hasWitness(lines: readonly string[], start: number): boolean {
  let seen = 0;
  for (let index = start; index < lines.length && seen < MAX_WITNESS_LINES; index += 1) {
    const line = lines[index] ?? "";
    const tokens = tokenizeLine(line);
    if (tokens.length === 0) {
      continue;
    }
    seen += 1;
    if (isWitnessLine(line, tokens)) {
      return true;
    }
  }
  return false;
}

/** True when the lines open like a HAProxy config, skipping comments and preambles. */
export function detectHaproxyConfig(lines: readonly string[]): boolean {
  const candidate = findSectionCandidate(lines);
  if (!candidate) {
    return false;
  }
  if (candidate.match.distinctive) {
    return true;
  }
  return hasWitness(lines, candidate.index + 1);
}
