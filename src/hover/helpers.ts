import { groupItems } from "../documentContext";
import { HaproxyLanguageData, LanguageGroupItem } from "../languageData";

export function findGroupItem(
  data: HaproxyLanguageData,
  name: string,
): LanguageGroupItem | undefined {
  for (const items of Object.values(data.groups)) {
    const exact = items.find((item) => item.name === name);
    if (exact) {
      return exact;
    }
  }
  const lower = name.toLowerCase();
  for (const items of Object.values(data.groups)) {
    const hit = items.find((item) => item.name.toLowerCase() === lower);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

export function findGroupItemIn(
  data: HaproxyLanguageData,
  groupName: string,
  name: string,
): LanguageGroupItem | undefined {
  const items = groupItems(data, groupName);
  return (
    items.find((item) => item.name === name) ??
    items.find((item) => item.name.toLowerCase() === name.toLowerCase())
  );
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
