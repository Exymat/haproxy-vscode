import {
  PREFIX_FAMILIES,
  actionTokenIndex,
  isAddressOrPathToken,
  isDirectivePart,
  isLikelyValue,
  isNumberToken,
  isWordToken,
  joinTokens,
  normalizeActionName,
  resolveAttemptedDirectiveSpan,
  resolveDirectiveSpan,
  resolveLongestDirectiveMatch,
  resolveSubcommandSpan,
  tcpPhaseIndex,
} from "../../src/tokenUtils";
import { parseDocument } from "../../src/parser";
import { createDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";

function parsedLine(content: string) {
  return parseDocument(createDocument(content) as never)[content.includes("\n") ? 1 : 0];
}

describe("tokenUtils", () => {
  const _schema = loadSchema("3.2");
  const allowed = new Set([
    "mode",
    "http-request",
    "stats socket",
    "tcp-request content",
    "timeout connect",
  ]);

  it("classifies token shapes", () => {
    expect(isWordToken("frontend")).toBe(true);
    expect(isWordToken("9bad")).toBe(false);
    expect(isDirectivePart("set-var")).toBe(true);
    expect(isNumberToken("10s")).toBe(true);
    expect(isNumberToken("abc")).toBe(false);
    expect(isLikelyValue("")).toBe(true);
    expect(isLikelyValue("<mode>")).toBe(true);
    expect(isLikelyValue('"hello"')).toBe(true);
    expect(isLikelyValue("{ dst }")).toBe(true);
    expect(isLikelyValue("1.2.3.4")).toBe(true);
    expect(isLikelyValue(".if")).toBe(true);
    expect(isLikelyValue("unknownword")).toBe(false);
    expect(isLikelyValue("TRUE", new Set(["true"]))).toBe(true);
    expect(isAddressOrPathToken(":443")).toBe(true);
    expect(isAddressOrPathToken('"path"')).toBe(true);
  });

  it("joinTokens combines slice", () => {
    const line = parsedLine("stats socket /run/haproxy.sock level admin");
    expect(joinTokens(line.tokens, 0, 1)).toBe("stats socket");
  });

  it("resolveLongestDirectiveMatch finds multi-token keywords", () => {
    const line = parsedLine("    stats socket /run/haproxy.sock");
    const match = resolveLongestDirectiveMatch(line, allowed);
    expect(match.matched).toBe(true);
    expect(match.keyword).toBe("stats socket");
  });

  it("resolveLongestDirectiveMatch handles empty tokens", () => {
    const line = parsedLine("# comment");
    expect(resolveLongestDirectiveMatch(line, allowed).matched).toBe(false);
  });

  it("resolveLongestDirectiveMatch handles modifier prefixes", () => {
    const line = parsedLine("    no log");
    const modifiers = new Set(["no"]);
    const noPrefix = new Set(["log"]);
    const match = resolveLongestDirectiveMatch(line, new Set(["log"]), 4, noPrefix, modifiers);
    expect(match.matched).toBe(true);
    expect(match.keyword).toBe("log");
  });

  it("resolveAttemptedDirectiveSpan stops at values", () => {
    const line = parsedLine("    notreal 123");
    const match = resolveAttemptedDirectiveSpan(line, 4, new Set([".if"]));
    expect(match.matched).toBe(false);
    expect(match.keyword).toBe("notreal");
  });

  it("resolveAttemptedDirectiveSpan handles empty line tokens", () => {
    const line = parsedLine("# only comment");
    expect(resolveAttemptedDirectiveSpan(line).matched).toBe(false);
  });

  it("resolveAttemptedDirectiveSpan stops on non-directive tokens", () => {
    const line = parsedLine("    123bad");
    expect(resolveAttemptedDirectiveSpan(line).keyword).toBe("123bad");
  });

  it("resolveAttemptedDirectiveSpan handles single non-directive token", () => {
    const line = parsedLine("    :8080");
    expect(resolveAttemptedDirectiveSpan(line).matched).toBe(false);
    expect(resolveAttemptedDirectiveSpan(line).keyword).toBe(":8080");
  });

  it("resolveSubcommandSpan matches timeout subcommands", () => {
    const allowedTimeouts = new Set(["timeout connect", "timeout client"]);
    const line = parsedLine("    timeout connect 5s");
    const sub = resolveSubcommandSpan(line, allowedTimeouts, "timeout");
    expect(sub?.matched).toBe(true);
    expect(sub?.subcommand).toBe("connect");
  });

  it("resolveSubcommandSpan returns null for wrong prefix", () => {
    const line = parsedLine("    mode http");
    expect(resolveSubcommandSpan(line, allowed, "timeout")).toBeNull();
  });

  it("resolveSubcommandSpan returns null without subcommands", () => {
    const line = parsedLine("    timeout connect 5s");
    expect(resolveSubcommandSpan(line, new Set(["mode"]), "timeout")).toBeNull();
  });

  it("resolveSubcommandSpan handles unmatched subcommand", () => {
    const allowedTimeouts = new Set(["timeout connect"]);
    const line = parsedLine("    timeout notreal 5s");
    const sub = resolveSubcommandSpan(line, allowedTimeouts, "timeout");
    expect(sub?.matched).toBe(false);
  });

  it("resolveDirectiveSpan delegates to longest match", () => {
    const line = parsedLine("    mode http");
    expect(resolveDirectiveSpan(line, new Set(["mode"]))).toEqual({ start: 0, end: 0 });
  });

  it("normalizeActionName strips parenthetical suffix", () => {
    expect(normalizeActionName("set-var(txn.path)")).toBe("set-var");
    expect(normalizeActionName("deny")).toBe("deny");
  });

  it("actionTokenIndex finds http and tcp rule actions", () => {
    expect(actionTokenIndex(parsedLine("    http-request deny if TRUE"))).toBe(1);
    expect(actionTokenIndex(parsedLine("    tcp-request content accept if TRUE"))).toBe(2);
    expect(actionTokenIndex(parsedLine("    tcp-response content reject if TRUE"))).toBe(2);
    expect(actionTokenIndex(parsedLine("global"))).toBeNull();
  });

  it("tcpPhaseIndex finds tcp phase token index", () => {
    const phases = new Set(["content", "session"]);
    expect(tcpPhaseIndex(parsedLine("    tcp-request content accept if TRUE"), phases)).toBe(1);
    expect(tcpPhaseIndex(parsedLine("    tcp-request notreal if TRUE"), phases)).toBe(1);
    expect(tcpPhaseIndex(parsedLine("    mode http"), phases)).toBeNull();
    expect(tcpPhaseIndex(parsedLine("    tcp-request"), phases)).toBeNull();
  });

  it("exports prefix families constant", () => {
    expect(PREFIX_FAMILIES).toContain("stats");
  });
});
