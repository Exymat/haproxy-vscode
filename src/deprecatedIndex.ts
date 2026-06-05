import { HaproxyLanguageData } from "./languageData";
import { HaproxySchema } from "./schema";

const DEPRECATED_MARK = /\(deprecated\)/i;

const ACTION_GROUP_KEYS = [
  "http_request_actions",
  "http_response_actions",
  "http_after_response_actions",
  "tcp_request_actions",
  "tcp_response_actions",
  "quic_initial_actions",
] as const;

export interface DeprecatedIndex {
  keywords: Set<string>;
  actions: Set<string>;
}

const indexCache = new WeakMap<HaproxySchema, Map<HaproxyLanguageData | undefined, DeprecatedIndex>>();

function signatureIsDeprecated(signatures: string[]): boolean {
  return signatures.some((signature) => DEPRECATED_MARK.test(signature));
}

export function buildDeprecatedIndex(
  schema: HaproxySchema,
  languageData?: HaproxyLanguageData
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
    for (const groupKey of ACTION_GROUP_KEYS) {
      for (const item of languageData.groups[groupKey] ?? []) {
        if (DEPRECATED_MARK.test(item.signature)) {
          actions.add(item.name.toLowerCase());
        }
      }
    }
  }

  const index: DeprecatedIndex = { keywords, actions };
  perSchema.set(languageData, index);
  return index;
}
