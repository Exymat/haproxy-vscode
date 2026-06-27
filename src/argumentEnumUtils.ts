import { LanguageArgumentParam, LanguageKeyword } from "./languageData";
import { ArgumentSlot, SchemaArgumentParam, SchemaKeyword } from "./schema";

const enumSlotCache = new WeakMap<SchemaKeyword, Map<string, string[]>>();

function cacheKeyForSchemaKeyword(schemaKw: SchemaKeyword | undefined): SchemaKeyword | null {
  return schemaKw ?? null;
}

export interface EnumValue {
  name: string;
  description: string;
}

function isSimpleEnumName(name: string): boolean {
  return /^[a-z][a-z0-9_.-]*$/i.test(name);
}

export function normalizeEnumDisplayName(name: string): string {
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    return name.slice(1, -1);
  }
  return name;
}

export function docEnumValueNames(schemaKw: SchemaKeyword | undefined): string[] {
  const values: string[] = [];
  for (const param of schemaKw?.arguments ?? []) {
    if (!param) {
      continue;
    }
    for (const value of param.values) {
      const base = value.name.split("(", 1)[0];
      if (isSimpleEnumName(base)) {
        values.push(base.toLowerCase());
      }
    }
  }
  return values;
}

function docEnumValueNamesForParameter(param: SchemaArgumentParam | undefined): string[] {
  const values: string[] = [];
  if (!param) {
    return values;
  }
  for (const value of param.values) {
    const base = value.name.split("(", 1)[0];
    if (isSimpleEnumName(base)) {
      values.push(base.toLowerCase());
    }
  }
  return values;
}

function shouldUseDocEnumHints(
  parameter: string | undefined,
  valueKind: string | undefined,
): boolean {
  if (valueKind === "enum") {
    return true;
  }
  if (valueKind && valueKind !== "generic") {
    return false;
  }
  if (!parameter) {
    return false;
  }
  const lower = parameter.toLowerCase();
  if (
    lower.includes("name") ||
    lower.includes("addr") ||
    lower.includes("path") ||
    lower.includes("file")
  ) {
    return false;
  }
  return lower.startsWith("<");
}

function enumSlotCacheKey(slot: ArgumentSlot | undefined, position: number): string {
  const enumPart = (slot?.enum ?? []).join("\0");
  const kindPart = slot?.value_kind ?? "";
  return `${position}:${kindPart}:${enumPart}`;
}

export function enumNamesForSlot(
  slot: ArgumentSlot | undefined,
  schemaKw: SchemaKeyword | undefined,
  position: number,
): string[] {
  const cacheOwner = cacheKeyForSchemaKeyword(schemaKw);
  if (cacheOwner) {
    const cacheKey = enumSlotCacheKey(slot, position);
    let perKeyword = enumSlotCache.get(cacheOwner);
    if (!perKeyword) {
      perKeyword = new Map();
      enumSlotCache.set(cacheOwner, perKeyword);
    }
    const cached = perKeyword.get(cacheKey);
    if (cached) {
      return cached;
    }
    const result = computeEnumNamesForSlot(slot, schemaKw, position);
    perKeyword.set(cacheKey, result);
    return result;
  }
  return computeEnumNamesForSlot(slot, schemaKw, position);
}

function computeEnumNamesForSlot(
  slot: ArgumentSlot | undefined,
  schemaKw: SchemaKeyword | undefined,
  position: number,
): string[] {
  const paramAtPosition =
    schemaKw?.arguments?.[position] ??
    (position === 0 ? schemaKw?.arguments?.find((p) => p?.parameter === "<algorithm>") : undefined);
  const fromSignature = (slot?.enum ?? []).map((value) => normalizeEnumDisplayName(value));
  if (fromSignature.length > 0) {
    const values = new Set(fromSignature.map((v) => v.toLowerCase()));
    const shouldMergeAllDocEnums = !(schemaKw?.name === "balance url_param" && position > 0);
    const docNames = shouldMergeAllDocEnums
      ? docEnumValueNames(schemaKw)
      : docEnumValueNamesForParameter(paramAtPosition);
    for (const name of docNames) {
      values.add(name);
    }
    return [...values].map((lower) => {
      const fromSig = fromSignature.find((v) => v.toLowerCase() === lower);
      if (fromSig) {
        return fromSig;
      }
      const fromDoc = (paramAtPosition?.values ?? []).find(
        (value) => value.name.split("(", 1)[0].toLowerCase() === lower,
      );
      return fromDoc?.name.split("(", 1)[0] ?? lower;
    });
  }

  const slotKind = slot?.value_kind ?? schemaKw?.argument_model?.slots?.[position]?.value_kind;
  if (!shouldUseDocEnumHints(paramAtPosition?.parameter, slotKind)) {
    return [];
  }
  const fromDoc = docEnumValueNamesForParameter(paramAtPosition);
  if (fromDoc.length >= 2) {
    return [...new Set(fromDoc)];
  }
  return [];
}

export function enumNamesForArgumentPosition(
  schemaKw: SchemaKeyword | undefined,
  langKw: LanguageKeyword | undefined,
  position: number,
): string[] {
  const slot = schemaKw?.argument_model?.slots?.[position];
  const fromSlot = enumNamesForSlot(slot, schemaKw, position);
  if (fromSlot.length > 0) {
    return fromSlot;
  }

  const langParam = langKw?.arguments?.[position];
  const slotKind = schemaKw?.argument_model?.slots?.[position]?.value_kind;
  if (
    langParam &&
    shouldUseDocEnumHints(langParam.parameter, slotKind) &&
    langParam.values.length >= 2
  ) {
    return langParam.values.map((value) => value.name.split("(", 1)[0]);
  }

  return [];
}

export function enumDescriptionsForKeyword(
  langKw: LanguageKeyword | undefined,
  schemaKw: SchemaKeyword | undefined,
): Map<string, string> {
  return descriptionMap(langKw, schemaKw);
}

function descriptionMap(
  langKw: LanguageKeyword | undefined,
  schemaKw: SchemaKeyword | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  const addParam = (param: SchemaArgumentParam | LanguageArgumentParam): void => {
    for (const value of param.values) {
      const base = value.name.split("(", 1)[0];
      map.set(base.toLowerCase(), value.description);
    }
  };
  for (const param of langKw?.arguments ?? []) {
    addParam(param);
  }
  for (const param of schemaKw?.arguments ?? []) {
    addParam(param);
  }
  return map;
}

export function filterDirectiveKeywordParts(
  values: EnumValue[],
  directiveKeyword: string,
): EnumValue[] {
  const parts = new Set(directiveKeyword.toLowerCase().split(/\s+/));
  return values.filter((value) => !parts.has(value.name.toLowerCase()));
}

export function mergeEnumValues(
  langValues: EnumValue[],
  schemaNames: string[],
  descriptions: Map<string, string>,
): EnumValue[] {
  const merged = new Map<string, EnumValue>();
  for (const value of langValues) {
    merged.set(value.name.toLowerCase(), value);
  }
  for (const rawName of schemaNames) {
    const name = normalizeEnumDisplayName(rawName);
    const key = name.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, { name, description: descriptions.get(key) ?? "" });
    }
  }
  return [...merged.values()];
}
