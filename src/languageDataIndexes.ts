import { resolveLanguageKeyword, ResolvedLanguageKeyword } from "./keywordVariant";
import { HaproxyLanguageData, LanguageGroupItem, LanguageKeyword } from "./languageData";

export interface LanguageDataIndexes {
  groupItemsByName: Map<string, Map<string, LanguageGroupItem>>;
  groupItemsByLowerName: Map<string, Map<string, LanguageGroupItem>>;
  keywordsBySection: Map<string, LanguageKeyword[]>;
  keywordNamesLowerBySection: Map<string, Set<string>>;
  resolvedKeywordsBySection: Map<string, ResolvedLanguageKeyword[]>;
}

let indexCache = new WeakMap<HaproxyLanguageData, LanguageDataIndexes>();

function buildGroupIndex(items: LanguageGroupItem[]): {
  byName: Map<string, LanguageGroupItem>;
  byLowerName: Map<string, LanguageGroupItem>;
} {
  const byName = new Map<string, LanguageGroupItem>();
  const byLowerName = new Map<string, LanguageGroupItem>();
  for (const item of items) {
    byName.set(item.name, item);
    byLowerName.set(item.name.toLowerCase(), item);
  }
  return { byName, byLowerName };
}

function buildLanguageDataIndexes(data: HaproxyLanguageData): LanguageDataIndexes {
  const groupItemsByName = new Map<string, Map<string, LanguageGroupItem>>();
  const groupItemsByLowerName = new Map<string, Map<string, LanguageGroupItem>>();
  for (const [groupName, items] of Object.entries(data.groups)) {
    const { byName, byLowerName } = buildGroupIndex(items);
    groupItemsByName.set(groupName, byName);
    groupItemsByLowerName.set(groupName, byLowerName);
  }

  const keywordsBySection = new Map<string, LanguageKeyword[]>();
  const keywordNamesLowerBySection = new Map<string, Set<string>>();
  const resolvedKeywordsBySection = new Map<string, ResolvedLanguageKeyword[]>();
  for (const kw of Object.values(data.keywords)) {
    for (const section of kw.sections ?? []) {
      const keywords = keywordsBySection.get(section) ?? [];
      keywords.push(kw);
      keywordsBySection.set(section, keywords);

      const lowerNames = keywordNamesLowerBySection.get(section) ?? new Set<string>();
      lowerNames.add(kw.name.toLowerCase());
      keywordNamesLowerBySection.set(section, lowerNames);
    }
  }
  for (const [section, keywords] of keywordsBySection) {
    const resolved: ResolvedLanguageKeyword[] = [];
    for (const kw of keywords) {
      const hit = resolveLanguageKeyword(kw, section);
      if (hit) {
        resolved.push(hit);
      }
    }
    resolvedKeywordsBySection.set(section, resolved);
  }

  return {
    groupItemsByName,
    groupItemsByLowerName,
    keywordsBySection,
    keywordNamesLowerBySection,
    resolvedKeywordsBySection,
  };
}

export function languageDataIndexes(data: HaproxyLanguageData): LanguageDataIndexes {
  const cached = indexCache.get(data);
  if (cached) {
    return cached;
  }
  const indexes = buildLanguageDataIndexes(data);
  indexCache.set(data, indexes);
  return indexes;
}

export function indexedGroupItems(
  data: HaproxyLanguageData,
  groupName: string,
): LanguageGroupItem[] {
  return data.groups[groupName] ?? [];
}

export function indexedGroupItemsByName(
  data: HaproxyLanguageData,
  groupName: string,
): Map<string, LanguageGroupItem> {
  return (
    languageDataIndexes(data).groupItemsByName.get(groupName) ??
    new Map<string, LanguageGroupItem>()
  );
}

export function groupItems(data: HaproxyLanguageData, groupName: string): LanguageGroupItem[] {
  return indexedGroupItems(data, groupName);
}

export function keywordsForSection(
  data: HaproxyLanguageData,
  section: string | null,
): LanguageKeyword[] {
  return indexedKeywordsForSection(data, section);
}

export function findIndexedGroupItem(
  data: HaproxyLanguageData,
  groupName: string,
  name: string,
): LanguageGroupItem | undefined {
  const indexes = languageDataIndexes(data);
  const exact = indexes.groupItemsByName.get(groupName)?.get(name);
  if (exact) {
    return exact;
  }
  return indexes.groupItemsByLowerName.get(groupName)?.get(name.toLowerCase());
}

export function indexedKeywordsForSection(
  data: HaproxyLanguageData,
  section: string | null,
): LanguageKeyword[] {
  if (!section) {
    return [];
  }
  return languageDataIndexes(data).keywordsBySection.get(section) ?? [];
}

export function indexedResolvedKeywordsForSection(
  data: HaproxyLanguageData,
  section: string | null,
): ResolvedLanguageKeyword[] {
  if (!section) {
    return [];
  }
  return languageDataIndexes(data).resolvedKeywordsBySection.get(section) ?? [];
}

export function indexedKeywordNameSetForSection(
  data: HaproxyLanguageData,
  section: string | null,
): ReadonlySet<string> {
  if (!section) {
    return new Set<string>();
  }
  return languageDataIndexes(data).keywordNamesLowerBySection.get(section) ?? new Set<string>();
}

export function clearLanguageDataIndexCache(): void {
  indexCache = new WeakMap();
}
