import type { SchemaValidationRules, KeysOfType, RecordKeys } from "./metadata.generated";
/** Accessors for schema validation-rule metadata. */
import {
  assertRecordShape,
  assertStringValue,
  metadataContractError,
  recordValue,
  stringArrayValue,
  stringMapValue,
} from "./contractHelpers";
import type { HaproxySchema } from "./types";

export function validationStringList(
  schema: HaproxySchema,
  key: KeysOfType<SchemaValidationRules, string[]>,
): string[] {
  return stringArrayValue(schema.validation_rules[key], `validation_rules.${key}`);
}

export function validationStringMap(
  schema: HaproxySchema,
  key: KeysOfType<SchemaValidationRules, Record<string, string>>,
): Record<string, string> {
  return stringMapValue(schema.validation_rules, key, "validation_rules");
}

export function validationStringValue(
  schema: HaproxySchema,
  key: KeysOfType<SchemaValidationRules, string>,
): string {
  const value = schema.validation_rules[key];
  assertStringValue(value, `validation_rules.${key}`);
  return value;
}

export function validationObjectArray(
  schema: HaproxySchema,
  key: KeysOfType<SchemaValidationRules, Array<object>>,
): NonNullable<SchemaValidationRules[typeof key]> {
  const value = schema.validation_rules[key];
  if (!Array.isArray(value)) {
    throw metadataContractError(`validation_rules.${key}`);
  }
  return value.map((item, index) => {
    const path = `validation_rules.${key}.${index}`;
    const record = assertRecordShape(item, path);
    return { match_tokens: stringArrayValue(record.match_tokens, `${path}.match_tokens`) };
  });
}

export function validationRecord<K extends RecordKeys<SchemaValidationRules>>(
  schema: HaproxySchema,
  key: K,
): NonNullable<SchemaValidationRules[K]> {
  return recordValue(schema.validation_rules, key, "validation_rules") as NonNullable<
    SchemaValidationRules[K]
  >;
}

export function addressDirectivePolicyKey(schema: HaproxySchema, keyword: string): string | null {
  return validationStringMap(schema, "address_directives")[keyword.toLowerCase()] ?? null;
}

export function logformatStopTokenSet(schema: HaproxySchema): Set<string> {
  return new Set(validationStringList(schema, "logformat_stop_tokens"));
}
