/** Shared helpers for resolving hover group items and sample-token candidates. */
import { HaproxyLanguageData, LanguageGroupItem } from "../language/languageData";
import { findIndexedGroupItem } from "../language/languageDataIndexes";
import { HoverContext } from "./types";

function previousTokenText(hc: HoverContext): string {
  return hc.ctx.line.tokens[hc.ctx.tokenIndex - 1]?.text.toLowerCase() ?? "";
}

function isAclRefContext(hc: HoverContext): boolean {
  if (hc.ctx.kind === "acl-criterion") {
    return true;
  }
  const tokens = hc.ctx.line.tokens;
  if ((tokens[0]?.text.toLowerCase() ?? "") === "acl") {
    return true;
  }
  for (let i = 0; i < hc.ctx.tokenIndex; i += 1) {
    const text = tokens[i]?.text.toLowerCase();
    if (text === "if" || text === "unless") {
      return true;
    }
  }
  return false;
}

export function aclRefGroupApplies(hc: HoverContext, groupName: string): boolean {
  const prev = previousTokenText(hc);
  switch (groupName) {
    case "acl_match_methods":
    case "acl_string_match_methods":
      return prev === "-m";
    case "acl_flags":
      return hc.ctx.token.text.startsWith("-") && isAclRefContext(hc);
    case "acl_int_operators":
      return isAclRefContext(hc) && prev !== "-m";
    case "acl_predefined":
      return isAclRefContext(hc);
    default:
      return true;
  }
}

export function findGroupItem(
  data: HaproxyLanguageData,
  name: string,
  groupAllowed?: (groupName: string) => boolean,
): LanguageGroupItem | undefined {
  for (const groupName of Object.keys(data.groups)) {
    if (groupAllowed && !groupAllowed(groupName)) {
      continue;
    }
    const hit = findIndexedGroupItem(data, groupName, name);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

export function sampleTokenCandidates(tokenText: string, cursorOffset: number): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: string | undefined): void => {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) {
      return;
    }
    seen.add(lower);
    candidates.push(trimmed);
  };

  push(tokenText);

  const exact = tokenText.match(/^[\w.-]+/);
  push(exact?.[0]);

  const clamped = Math.max(0, Math.min(cursorOffset, tokenText.length - 1));
  const isIdent = (ch: string | undefined) => Boolean(ch && /[\w.-]/.test(ch));
  if (isIdent(tokenText[clamped])) {
    let start = clamped;
    let end = clamped + 1;
    while (start > 0 && isIdent(tokenText[start - 1])) {
      start -= 1;
    }
    while (end < tokenText.length && isIdent(tokenText[end])) {
      end += 1;
    }
    push(tokenText.slice(start, end));
  }

  return candidates;
}
