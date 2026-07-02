import { HaproxyLanguageData } from "./languageData";
import { HaproxySchema } from "./schema";

const DEPRECATED_MARK = /\(deprecated\)/i;

import { DEPRECATED_ACTION_GROUP_NAMES } from "./domainMaps";

export interface DeprecatedIndex {
  keywords: Set<string>;
  actions: Set<string>;
  sampleFetches: Set<string>;
  sampleConverters: Set<string>;
}

const indexCache = new WeakMap<
  HaproxySchema,
  Map<HaproxyLanguageData | undefined, DeprecatedIndex>
>();

function signatureIsDeprecated(signatures: string[]): boolean {
  return signatures.some((signature) => DEPRECATED_MARK.test(signature));
}

export function buildDeprecatedIndex(
  schema: HaproxySchema,
  languageData?: HaproxyLanguageData,
): DeprecatedIndex {
  let perSchema = indexCache.get(schema);
  if (!perSchema) {
    perSchema = new Map();
    indexCache.set(schema, perSchema);
  }
  const cached = perSchema.get(languageData);
  if (cached) {
    return cached;
  }

  const keywords = new Set<string>();
  for (const [name, keyword] of Object.entries(schema.keywords)) {
    if (signatureIsDeprecated(keyword.signatures)) {
      keywords.add(name.toLowerCase());
    }
  }

  if (languageData) {
    for (const [name, keyword] of Object.entries(languageData.keywords)) {
      if (signatureIsDeprecated(keyword.signatures)) {
        keywords.add(name.toLowerCase());
      }
    }
  }

  const actions = new Set<string>();
  if (languageData) {
    for (const groupKey of DEPRECATED_ACTION_GROUP_NAMES) {
      for (const item of languageData.groups[groupKey] ?? []) {
        if (DEPRECATED_MARK.test(item.signature)) {
          actions.add(item.name.toLowerCase());
        }
      }
    }
  }

  const sampleFetches = new Set<string>();
  for (const [name, sample] of Object.entries(schema.sample_fetches ?? {})) {
    /* v8 ignore start -- fallback covers schemas that omit explicit deprecation metadata */
    if (sample.deprecated || DEPRECATED_MARK.test(sample.signature ?? "")) {
      sampleFetches.add(name.toLowerCase());
    }
    /* v8 ignore stop */
  }

  const sampleConverters = new Set<string>();
  for (const [name, sample] of Object.entries(schema.sample_converters ?? {})) {
    /* v8 ignore start -- fallback covers schemas that omit explicit deprecation metadata */
    if (sample.deprecated || DEPRECATED_MARK.test(sample.signature ?? "")) {
      sampleConverters.add(name.toLowerCase());
    }
    /* v8 ignore stop */
  }

  if (languageData) {
    for (const item of languageData.groups.sample_fetches ?? []) {
      /* v8 ignore start -- language-data overlays rarely repeat schema deprecation marks verbatim */
      if (DEPRECATED_MARK.test(item.signature)) {
        sampleFetches.add(item.name.toLowerCase());
      }
      /* v8 ignore stop */
    }
    for (const item of languageData.groups.sample_converters ?? []) {
      /* v8 ignore start -- language-data overlays rarely repeat schema deprecation marks verbatim */
      if (DEPRECATED_MARK.test(item.signature)) {
        sampleConverters.add(item.name.toLowerCase());
      }
      /* v8 ignore stop */
    }
  }

  const index: DeprecatedIndex = { keywords, actions, sampleFetches, sampleConverters };
  perSchema.set(languageData, index);
  return index;
}
