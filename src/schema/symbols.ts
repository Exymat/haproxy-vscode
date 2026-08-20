/** Accessors for schema symbol lists and sets such as sections and ACL operators. */
import { recordValue, stringArrayValue, stringMapValue } from "./contractHelpers";
import { symbolStringSetCache } from "./cache";
import type { HaproxySchema } from "./types";
import { isSymbolKind, SymbolKind } from "../core/editorKinds";

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

export function symbolKindList(schema: HaproxySchema, key: string): SymbolKind[] {
  return symbolStringList(schema, key).map((kind) => {
    if (!isSymbolKind(kind)) {
      throw new Error(`symbols.${key} contains unknown symbol kind '${kind}'`);
    }
    return kind;
  });
}

export function symbolKindSet(schema: HaproxySchema, key: string): Set<SymbolKind> {
  return new Set(symbolKindList(schema, key));
}

export function symbolKindMap(schema: HaproxySchema, key: string): Record<string, SymbolKind> {
  const result: Record<string, SymbolKind> = {};
  for (const [name, kind] of Object.entries(symbolStringMap(schema, key))) {
    if (!isSymbolKind(kind)) {
      throw new Error(`symbols.${key}.${name} contains unknown symbol kind '${kind}'`);
    }
    result[name] = kind;
  }
  return result;
}

export function symbolRecord(schema: HaproxySchema, key: string): Record<string, unknown> {
  return recordValue(schema.symbols, key, "symbols");
}
