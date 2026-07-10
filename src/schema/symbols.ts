import { recordValue, stringArrayValue, stringMapValue } from "./contractHelpers";
import { symbolStringSetCache } from "./cache";
import type { HaproxySchema } from "./types";

export function symbolStringList(schema: HaproxySchema, key: string): string[] {
  return stringArrayValue(schema.symbols[key], `symbols.${key}`);
}

export function symbolStringSet(schema: HaproxySchema, key: string): Set<string> {
  let perSchema = symbolStringSetCache.get(schema);
  if (!perSchema) {
    perSchema = new Map();
    symbolStringSetCache.set(schema, perSchema);
  }
  const cached = perSchema.get(key);
  if (cached) {
    return cached;
  }
  const result = new Set(symbolStringList(schema, key));
  perSchema.set(key, result);
  return result;
}

export function namedSectionSet(schema: HaproxySchema): Set<string> {
  return symbolStringSet(schema, "named_sections");
}

export function entryPointSectionSet(schema: HaproxySchema): Set<string> {
  return symbolStringSet(schema, "entry_point_sections");
}

export function bindDetectKeywordSet(schema: HaproxySchema): Set<string> {
  return symbolStringSet(schema, "bind_detect_keywords");
}

export function symbolStringMap(schema: HaproxySchema, key: string): Record<string, string> {
  return stringMapValue(schema.symbols, key, "symbols");
}

export function symbolRecord(schema: HaproxySchema, key: string): Record<string, unknown> {
  return recordValue(schema.symbols, key, "symbols");
}
