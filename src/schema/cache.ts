import type { HaproxySchema } from "./types";

interface SectionKeywordCacheEntry {
  allowed: Set<string>;
  hasOptionKeywords: boolean;
}

export const sectionKeywordCache = new WeakMap<
  HaproxySchema,
  Map<string, SectionKeywordCacheEntry>
>();
export const keywordGroupSetCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
export const lineOptionSetCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
export const optionsWithValueCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
export const noPrefixKeywordCache = new WeakMap<HaproxySchema, Set<string>>();
export const modifierPrefixCache = new WeakMap<HaproxySchema, Set<string>>();
export const macroTokenCache = new WeakMap<HaproxySchema, Set<string>>();
export const conditionalTokenCache = new WeakMap<HaproxySchema, Set<string>>();
export const namedDefaultsKeywordCache = new WeakMap<HaproxySchema, Set<string>>();
export const sampleExpressionNameCache = new WeakMap<
  HaproxySchema,
  { fetchNames: Set<string>; convNames: Set<string> }
>();
export const prefixSubcommandCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
export const prefixFamilyCache = new WeakMap<HaproxySchema, Set<string>>();
export const tcpRequestPhaseCache = new WeakMap<HaproxySchema, Set<string>>();
export const tcpResponsePhaseCache = new WeakMap<HaproxySchema, Set<string>>();
export const statsSocketLevelCache = new WeakMap<HaproxySchema, Set<string>>();
export const sectionHeaderSetCache = new WeakMap<HaproxySchema, Set<string>>();
export const sortedSectionHeaderCache = new WeakMap<HaproxySchema, string[]>();
export const symbolStringSetCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
export const logFormatDirectiveKeywordCache = new WeakMap<HaproxySchema, Set<string>>();

export function tokenSetFromSchema(
  schema: HaproxySchema,
  cache: WeakMap<HaproxySchema, Set<string>>,
  values: string[] | undefined,
): Set<string> {
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  const result = new Set((values ?? []).map((v) => v.toLowerCase()));
  cache.set(schema, result);
  return result;
}

export function perSchemaMapCache<V>(
  outerCache: WeakMap<HaproxySchema, Map<string, V>>,
): (schema: HaproxySchema, key: string, build: () => V) => V {
  return (schema, key, build) => {
    let perSchema = outerCache.get(schema);
    if (!perSchema) {
      perSchema = new Map();
      outerCache.set(schema, perSchema);
    }
    const cached = perSchema.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = build();
    perSchema.set(key, result);
    return result;
  };
}

export const keywordGroupSetCached = perSchemaMapCache(keywordGroupSetCache);
export const lineOptionSetCached = perSchemaMapCache(lineOptionSetCache);
export const optionsWithValueCached = perSchemaMapCache(optionsWithValueCache);
export const prefixSubcommandCached = perSchemaMapCache(prefixSubcommandCache);
