import {
  keywordGroupSetCached,
  lineOptionSetCached,
  optionsWithValueCached,
  prefixSubcommandCached,
  sectionKeywordCache,
} from "./cache";
import type { HaproxySchema } from "./types";

interface SectionKeywordCacheEntry {
  allowed: Set<string>;
  hasOptionKeywords: boolean;
}

export function buildPrefixSubcommands(keywords: Iterable<string>, prefix: string): Set<string> {
  const needle = `${prefix.toLowerCase()} `;
  const subs = new Set<string>();
  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();
    if (lower.startsWith(needle)) {
      subs.add(lower.slice(needle.length));
    }
  }
  return subs;
}

export function prefixSubcommandSet(schema: HaproxySchema, prefix: string): Set<string> {
  const key = prefix.toLowerCase();
  return prefixSubcommandCached(schema, key, () => {
    const fromLayout = schema.line_layout?.prefix_subcommands?.[key];
    return fromLayout
      ? new Set(fromLayout.map((v) => v.toLowerCase()))
      : buildPrefixSubcommands(Object.keys(schema.keywords), prefix);
  });
}

export function optionsWithValueSet(schema: HaproxySchema, groupName: string): Set<string> {
  return optionsWithValueCached(schema, groupName, () => {
    const explicitKey = `${groupName}_with_value`;
    const explicit = schema.keyword_groups[explicitKey] ?? [];
    return new Set(explicit.map((v) => v.toLowerCase()));
  });
}

export function keywordGroupSet(schema: HaproxySchema, groupName: string): Set<string> {
  return keywordGroupSetCached(
    schema,
    groupName,
    () => new Set((schema.keyword_groups[groupName] ?? []).map((v) => v.toLowerCase())),
  );
}

export function lineOptionSet(schema: HaproxySchema, groupName: string): Set<string> {
  return lineOptionSetCached(schema, groupName, () => {
    const result = new Set(keywordGroupSet(schema, groupName));
    for (const option of optionsWithValueSet(schema, groupName)) {
      result.add(option);
    }
    return result;
  });
}

function buildSectionKeywordEntry(
  schema: HaproxySchema,
  section: string,
): SectionKeywordCacheEntry {
  const allowed = new Set((schema.sections[section]?.keywords ?? []).map((k) => k.toLowerCase()));
  let hasOptionKeywords = false;
  for (const [name, keyword] of Object.entries(schema.keywords)) {
    if (keyword.sections.includes(section)) {
      allowed.add(name.toLowerCase());
    }
  }
  const optionKeywords = keywordGroupSet(schema, "options");
  for (const keyword of allowed) {
    if (keyword === "option") {
      hasOptionKeywords = true;
      break;
    }
    if (keyword.startsWith("option ")) {
      hasOptionKeywords = optionKeywords.has(keyword.slice("option ".length));
      if (hasOptionKeywords) {
        break;
      }
    }
    if (keyword.startsWith("no option ")) {
      hasOptionKeywords = optionKeywords.has(keyword.slice("no option ".length));
      if (hasOptionKeywords) {
        break;
      }
    }
  }
  return { allowed, hasOptionKeywords };
}

function sectionKeywordEntry(schema: HaproxySchema, section: string): SectionKeywordCacheEntry {
  let perSchema = sectionKeywordCache.get(schema);
  if (!perSchema) {
    perSchema = new Map();
    sectionKeywordCache.set(schema, perSchema);
  }
  const cached = perSchema.get(section);
  if (cached) {
    return cached;
  }
  const entry = buildSectionKeywordEntry(schema, section);
  perSchema.set(section, entry);
  return entry;
}

export function sectionKeywordSet(schema: HaproxySchema, section: string | null): Set<string> {
  if (!section) {
    return new Set();
  }
  return sectionKeywordEntry(schema, section).allowed;
}

export function sectionHasOptionKeywords(schema: HaproxySchema, section: string | null): boolean {
  if (!section) {
    return false;
  }
  return sectionKeywordEntry(schema, section).hasOptionKeywords;
}
