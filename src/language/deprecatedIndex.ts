/** Builds indexes of deprecated keywords, actions, and sample functions. */
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

function addDeprecatedKeywordNames(
  target: Set<string>,
  table: Record<string, { signatures: string[] }>,
): void {
  for (const [name, keyword] of Object.entries(table)) {
    if (signatureIsDeprecated(keyword.signatures)) {
      target.add(name.toLowerCase());
    }
  }
}

function addDeprecatedGroupItems(
  target: Set<string>,
  items: Array<{ name: string; signature: string }> | undefined,
): void {
  for (const item of items ?? []) {
    if (DEPRECATED_MARK.test(item.signature)) {
      target.add(item.name.toLowerCase());
    }
  }
}

function addDeprecatedSamples(
  target: Set<string>,
  table: Record<string, { deprecated?: boolean; signature?: string }> | undefined,
): void {
  for (const [name, sample] of Object.entries(table ?? {})) {
    if (sample.deprecated || DEPRECATED_MARK.test(sample.signature ?? "")) {
      target.add(name.toLowerCase());
    }
  }
}

function collectDeprecatedIndex(
  schema: HaproxySchema,
  languageData?: HaproxyLanguageData,
): DeprecatedIndex {
  const keywords = new Set<string>();
  addDeprecatedKeywordNames(keywords, schema.keywords);
  if (languageData) {
    addDeprecatedKeywordNames(keywords, languageData.keywords);
  }

  const actions = new Set<string>();
  if (languageData) {
    for (const groupKey of deprecatedActionGroupNames(schema)) {
      addDeprecatedGroupItems(actions, languageData.groups[groupKey]);
    }
  }

  const sampleFetches = new Set<string>();
  const sampleConverters = new Set<string>();
  addDeprecatedSamples(sampleFetches, schema.sample_fetches);
  addDeprecatedSamples(sampleConverters, schema.sample_converters);
  if (languageData) {
    addDeprecatedGroupItems(sampleFetches, languageData.groups.sample_fetches);
    addDeprecatedGroupItems(sampleConverters, languageData.groups.sample_converters);
  }

  return { keywords, actions, sampleFetches, sampleConverters };
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

  const index = collectDeprecatedIndex(schema, languageData);
  perSchema.set(languageData, index);
  return index;
}
