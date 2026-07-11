import { ParsedToken } from "./index";
import { ReferencePattern } from "../schema/types";

export interface ReferencePatternMatch {
  start: number;
  targetIndex: number;
  targetToken: ParsedToken;
}

function tokensMatchPattern(tokens: ParsedToken[], start: number, matchTokens: string[]): boolean {
  for (let i = 0; i < matchTokens.length; i += 1) {
    const expected = matchTokens[i]?.toLowerCase();
    if (expected === "*") {
      continue;
    }
    if (tokens[start + i]?.text.toLowerCase() !== expected) {
      return false;
    }
  }
  return true;
}

/** All sliding-window matches for a reference pattern on a token line. */
export function findReferencePatternMatches(
  tokens: ParsedToken[],
  pattern: ReferencePattern,
): ReferencePatternMatch[] {
  const matchLength = pattern.match_tokens.length;
  if (matchLength === 0 || tokens.length <= pattern.target_token_index) {
    return [];
  }

  const hits: ReferencePatternMatch[] = [];
  const startPositions =
    pattern.scope === "section-header"
      ? [0]
      : Array.from({ length: tokens.length - matchLength + 1 }, (_, index) => index);
  for (const start of startPositions) {
    if (!tokensMatchPattern(tokens, start, pattern.match_tokens)) {
      continue;
    }
    const targetIndex = start + pattern.target_token_index;
    const targetToken = tokens[targetIndex];
    if (!targetToken) {
      continue;
    }
    hits.push({ start, targetIndex, targetToken });
  }
  return hits;
}

/** First match whose target token index equals the given index. */
export function findReferencePatternAtToken(
  tokens: ParsedToken[],
  pattern: ReferencePattern,
  tokenIndex: number,
): ReferencePatternMatch | null {
  for (const hit of findReferencePatternMatches(tokens, pattern)) {
    if (hit.targetIndex === tokenIndex) {
      return hit;
    }
  }
  return null;
}
