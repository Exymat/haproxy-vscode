import { LanguageArgumentParam, LanguageKeyword } from "./languageData";
import { ArgumentSlot, SchemaArgumentParam, SchemaKeyword } from "./schema";

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

function shouldUseDocEnumHints(parameter: string | undefined): boolean {
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

export function enumNamesForSlot(
  slot: ArgumentSlot | undefined,
  schemaKw: SchemaKeyword | undefined,
  position: number,
): string[] {
  const fromSignature = (slot?.enum ?? []).map((value) => normalizeEnumDisplayName(value));
  if (fromSignature.length > 0) {
    const values = new Set(fromSignature.map((v) => v.toLowerCase()));
    for (const name of docEnumValueNames(schemaKw)) {
      values.add(name);
    }
    return [...values].map((lower) => {
      const fromSig = fromSignature.find((v) => v.toLowerCase() === lower);
      if (fromSig) {
        return fromSig;
      }
      const fromDoc = (schemaKw?.arguments ?? [])
        .flatMap((param) => param.values)
        .find((value) => value.name.split("(", 1)[0].toLowerCase() === lower);
      return fromDoc?.name.split("(", 1)[0] ?? lower;
    });
  }

  const param =
    schemaKw?.arguments?.[position] ??
    (position === 0 ? schemaKw?.arguments?.find((p) => p?.parameter === "<algorithm>") : undefined);
  if (!shouldUseDocEnumHints(param?.parameter)) {
    return [];
  }
  const fromDoc = docEnumValueNames(schemaKw);
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
  if (langParam && shouldUseDocEnumHints(langParam.parameter) && langParam.values.length >= 2) {
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
