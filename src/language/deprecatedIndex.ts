import { HaproxyLanguageData } from "./languageData";
import { HaproxySchema } from "../schema/types";
import { deprecatedActionGroupNames } from "../schema/semantic";

const DEPRECATED_MARK = /\(deprecated\)/i;

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
    for (const groupKey of deprecatedActionGroupNames(schema)) {
      for (const item of languageData.groups[groupKey] ?? []) {
        if (DEPRECATED_MARK.test(item.signature)) {
          actions.add(item.name.toLowerCase());
        }
      }
    }
  }

  const sampleFetches = new Set<string>();
  for (const [name, sample] of Object.entries(schema.sample_fetches ?? {})) {
    if (sample.deprecated || DEPRECATED_MARK.test(sample.signature ?? "")) {
      sampleFetches.add(name.toLowerCase());
    }
  }

  const sampleConverters = new Set<string>();
  for (const [name, sample] of Object.entries(schema.sample_converters ?? {})) {
    if (sample.deprecated || DEPRECATED_MARK.test(sample.signature ?? "")) {
      sampleConverters.add(name.toLowerCase());
    }
  }

  if (languageData) {
    for (const item of languageData.groups.sample_fetches ?? []) {
      if (DEPRECATED_MARK.test(item.signature)) {
        sampleFetches.add(item.name.toLowerCase());
      }
    }
    for (const item of languageData.groups.sample_converters ?? []) {
      if (DEPRECATED_MARK.test(item.signature)) {
        sampleConverters.add(item.name.toLowerCase());
      }
    }
  }

  const index: DeprecatedIndex = { keywords, actions, sampleFetches, sampleConverters };
  perSchema.set(languageData, index);
  return index;
}
