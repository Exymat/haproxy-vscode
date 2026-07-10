import {
  conditionalTokenCache,
  macroTokenCache,
  modifierPrefixCache,
  namedDefaultsKeywordCache,
  noPrefixKeywordCache,
  sampleExpressionNameCache,
  tokenSetFromSchema,
} from "./cache";
import type { HaproxySchema } from "./types";

export function noPrefixKeywordSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, noPrefixKeywordCache, schema.tokens.no_prefix_keywords);
}

export function modifierPrefixSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, modifierPrefixCache, schema.tokens.modifiers);
}

export function macroTokenSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, macroTokenCache, schema.tokens.macros);
}

export function conditionalTokenSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, conditionalTokenCache, schema.tokens.conditionals);
}

export function namedDefaultsKeywordSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(
    schema,
    namedDefaultsKeywordCache,
    schema.tokens.named_defaults_keywords,
  );
}

export function sampleExpressionNameSets(schema: HaproxySchema): {
  fetchNames: Set<string>;
  convNames: Set<string>;
} {
  const cached = sampleExpressionNameCache.get(schema);
  if (cached) {
    return cached;
  }
  const fetchNames = new Set(
    Object.keys(schema.sample_fetches ?? {}).map((name) => name.toLowerCase()),
  );
  const convNames = new Set(
    Object.keys(schema.sample_converters ?? {}).map((name) => name.toLowerCase()),
  );
  for (const name of schema.keyword_groups.sample_fetches ?? []) {
    fetchNames.add(name.toLowerCase());
  }
  for (const name of schema.keyword_groups.sample_converters ?? []) {
    convNames.add(name.toLowerCase());
  }
  const result = { fetchNames, convNames };
  sampleExpressionNameCache.set(schema, result);
  return result;
}
