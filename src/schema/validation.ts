import {
  assertRecordShape,
  assertStringValue,
  metadataContractError,
  recordValue,
  stringArrayValue,
  stringMapValue,
} from "./contractHelpers";
import type { HaproxySchema } from "./types";

export function validationStringList(schema: HaproxySchema, key: string): string[] {
  return stringArrayValue(schema.validation_rules[key], `validation_rules.${key}`);
}

export function validationStringMap(schema: HaproxySchema, key: string): Record<string, string> {
  return stringMapValue(schema.validation_rules, key, "validation_rules");
}

export function validationStringValue(schema: HaproxySchema, key: string): string {
  const value = schema.validation_rules[key];
  assertStringValue(value, `validation_rules.${key}`);
  return value;
}

export function validationObjectArray<T extends Record<string, unknown>>(
  schema: HaproxySchema,
  key: string,
): T[] {
  const value = schema.validation_rules[key];
  if (!Array.isArray(value)) {
    throw metadataContractError(`validation_rules.${key}`);
  }
  return value.map(
    (item, index) => assertRecordShape(item, `validation_rules.${key}.${index}`) as T,
  );
}

export function validationRecord(schema: HaproxySchema, key: string): Record<string, unknown> {
  return recordValue(schema.validation_rules, key, "validation_rules");
}

export function addressDirectivePolicyKey(schema: HaproxySchema, keyword: string): string | null {
  return validationStringMap(schema, "address_directives")[keyword.toLowerCase()] ?? null;
}

export function logformatStopTokenSet(schema: HaproxySchema): Set<string> {
  return new Set(validationStringList(schema, "logformat_stop_tokens"));
}
