/** Validates and normalizes loaded HAProxy schema JSON against the metadata contract. */
import {
  assertBooleanMatrixValue,
  assertNestedStringArrayRecord,
  assertOptionalBooleanArrayValue,
  assertOptionalBooleanValue,
  assertOptionalNumberValue,
  assertOptionalStringArrayValue,
  assertOptionalStringValue,
  assertRecordShape,
  assertStringArrayRecord,
  assertStringValue,
  isRecord,
  metadataContractError,
  stringArrayValue,
} from "./contractHelpers";
import { ARGUMENT_VALUE_KINDS } from "./metadata.generated";
import type { HaproxySchema } from "./types";

function assertAddressPoliciesContract(value: unknown): void {
  const policies = assertRecordShape(value, "address_policies");
  for (const [name, item] of Object.entries(policies)) {
    const path = `address_policies.${name}`;
    const policy = assertRecordShape(item, path);
    for (const key of ["portOk", "portMandatory", "portRange", "portOffset"] as const) {
      if (typeof policy[key] !== "boolean") {
        throw metadataContractError(`${path}.${key}`);
      }
    }
  }
}

function assertFixedSlotContract(value: unknown, path: string): void {
  const slot = assertRecordShape(value, path);
  assertStringValue(slot.role, `${path}.role`);
  assertOptionalStringValue(slot.port, `${path}.port`);
  assertOptionalStringValue(slot.address_policy, `${path}.address_policy`);
}

function assertStatementRulesContract(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error("HAProxy schema is missing statement_rules");
  }
  value.forEach((item, index) => {
    const path = `statement_rules.${index}`;
    const rule = assertRecordShape(item, path);
    assertStringValue(rule.keyword, `${path}.keyword`);
    assertStringValue(rule.kind, `${path}.kind`);
    assertOptionalStringValue(rule.group, `${path}.group`);
    assertOptionalStringArrayValue(rule.match_tokens, `${path}.match_tokens`);
    assertOptionalNumberValue(rule.minimum_token_index, `${path}.minimum_token_index`);
    assertOptionalNumberValue(rule.value_token_index, `${path}.value_token_index`);
    assertOptionalNumberValue(rule.action_token_index, `${path}.action_token_index`);
    assertOptionalNumberValue(rule.phase_token_index, `${path}.phase_token_index`);
    assertOptionalNumberValue(rule.nested_start_index, `${path}.nested_start_index`);
    assertOptionalStringValue(rule.prefix, `${path}.prefix`);
    assertOptionalStringArrayValue(rule.sections, `${path}.sections`);
    assertOptionalStringValue(rule.reference_kind, `${path}.reference_kind`);
    assertOptionalStringValue(rule.definition_kind, `${path}.definition_kind`);
    assertOptionalNumberValue(rule.symbol_name_token_index, `${path}.symbol_name_token_index`);
    assertOptionalNumberValue(
      rule.symbol_name_token_from_index,
      `${path}.symbol_name_token_from_index`,
    );
    if (rule.fixed_slots !== undefined) {
      if (!Array.isArray(rule.fixed_slots)) {
        throw metadataContractError(`${path}.fixed_slots`);
      }
      rule.fixed_slots.forEach((slot, slotIndex) => {
        assertFixedSlotContract(slot, `${path}.fixed_slots.${slotIndex}`);
      });
    }
  });
}

function assertReferencePatternsContract(value: unknown): void {
  if (!Array.isArray(value)) {
    throw metadataContractError("reference_patterns");
  }
  value.forEach((item, index) => {
    const path = `reference_patterns.${index}`;
    const pattern = assertRecordShape(item, path);
    stringArrayValue(pattern.match_tokens, `${path}.match_tokens`);
    assertStringValue(pattern.reference_kind, `${path}.reference_kind`);
    if (typeof pattern.target_token_index !== "number") {
      throw metadataContractError(`${path}.target_token_index`);
    }
    if (
      pattern.scope !== undefined &&
      pattern.scope !== "global" &&
      pattern.scope !== "section" &&
      pattern.scope !== "section-header"
    ) {
      throw metadataContractError(`${path}.scope`);
    }
    assertOptionalStringValue(pattern.split, `${path}.split`);
    assertOptionalStringValue(pattern.target_prefix, `${path}.target_prefix`);
  });
}

function assertLineLayoutContract(value: unknown): void {
  const layout = assertRecordShape(value, "line_layout");
  assertOptionalStringArrayValue(layout.prefix_families, "line_layout.prefix_families");
  assertOptionalStringArrayValue(layout.tcp_request_phases, "line_layout.tcp_request_phases");
  assertOptionalStringArrayValue(layout.tcp_response_phases, "line_layout.tcp_response_phases");
  assertOptionalStringArrayValue(layout.stats_socket_levels, "line_layout.stats_socket_levels");
  assertOptionalStringArrayValue(layout.section_headers, "line_layout.section_headers");
  if (layout.prefix_subcommands !== undefined) {
    assertStringArrayRecord(layout.prefix_subcommands, "line_layout.prefix_subcommands");
  }
}

function assertSampleFunctionContract(value: unknown, path: string): void {
  const sample = assertRecordShape(value, path);
  assertStringValue(sample.name, `${path}.name`);
  stringArrayValue(sample.args, `${path}.args`);
  assertStringValue(sample.out_type, `${path}.out_type`);
  assertOptionalStringValue(sample.in_type, `${path}.in_type`);
  assertOptionalBooleanArrayValue(sample.contexts, `${path}.contexts`);
  assertOptionalNumberValue(sample.min_args, `${path}.min_args`);
  assertOptionalNumberValue(sample.max_args, `${path}.max_args`);
  assertOptionalStringValue(sample.signature, `${path}.signature`);
  assertOptionalStringValue(sample.chapter, `${path}.chapter`);
  assertOptionalBooleanValue(sample.deprecated, `${path}.deprecated`);
}

function assertSampleFunctionMapContract(value: unknown, path: string): void {
  const record = assertRecordShape(value, path);
  for (const [name, sample] of Object.entries(record)) {
    assertSampleFunctionContract(sample, `${path}.${name}`);
  }
}

function assertArgumentModelContract(value: unknown, path: string): void {
  if (value === undefined || value === null) {
    return;
  }
  const model = assertRecordShape(value, path);
  if (typeof model.min_args !== "number") {
    throw metadataContractError(`${path}.min_args`);
  }
  assertOptionalNumberValue(model.max_args, `${path}.max_args`);
  if (!Array.isArray(model.slots)) {
    throw metadataContractError(`${path}.slots`);
  }
  model.slots.forEach((value, index) => {
    const slotPath = `${path}.slots.${index}`;
    const slot = assertRecordShape(value, slotPath);
    assertOptionalBooleanValue(slot.optional, `${slotPath}.optional`);
    assertOptionalBooleanValue(slot.variadic, `${slotPath}.variadic`);
    assertOptionalStringArrayValue(slot.enum, `${slotPath}.enum`);
    if (
      slot.value_kind !== undefined &&
      !ARGUMENT_VALUE_KINDS.some((kind) => kind === slot.value_kind)
    ) {
      throw metadataContractError(`${slotPath}.value_kind`);
    }
  });
}

function assertKeywordArgumentModels(value: unknown): void {
  const keywords = assertRecordShape(value, "keywords");
  for (const [name, value] of Object.entries(keywords)) {
    const path = `keywords.${name}`;
    const keyword = assertRecordShape(value, path);
    assertArgumentModelContract(keyword.argument_model, `${path}.argument_model`);
    if (keyword.variants !== undefined) {
      if (!Array.isArray(keyword.variants)) {
        throw metadataContractError(`${path}.variants`);
      }
      keyword.variants.forEach((value, index) => {
        const variantPath = `${path}.variants.${index}`;
        const variant = assertRecordShape(value, variantPath);
        assertArgumentModelContract(variant.argument_model, `${variantPath}.argument_model`);
      });
    }
  }
}

function assertSchemaContract(value: unknown): asserts value is HaproxySchema {
  const data = assertRecordShape(value, "schema");
  if (!data.version || typeof data.version !== "string") {
    throw new Error("HAProxy schema is missing a version string");
  }
  if (!isRecord(data.sections)) {
    throw new Error("HAProxy schema is missing sections");
  }
  if (!isRecord(data.keywords)) {
    throw new Error("HAProxy schema is missing keywords");
  }
  assertKeywordArgumentModels(data.keywords);
  assertStatementRulesContract(data.statement_rules);
  if (!isRecord(data.address_policies)) {
    throw new Error("HAProxy schema is missing address_policies");
  }
  if (!Array.isArray(data.sample_types)) {
    throw new Error("HAProxy schema is missing sample_types");
  }
  if (!Array.isArray(data.sample_casts)) {
    throw new Error("HAProxy schema is missing sample_casts");
  }
  if (!isRecord(data.symbols)) {
    throw new Error("HAProxy schema is missing symbols");
  }
  if (!isRecord(data.semantic_groups)) {
    throw new Error("HAProxy schema is missing semantic_groups");
  }
  if (!isRecord(data.validation_rules)) {
    throw new Error("HAProxy schema is missing validation_rules");
  }
  if (!isRecord(data.keyword_groups)) {
    throw new Error("HAProxy schema is missing keyword_groups");
  }
  if (!isRecord(data.keyword_group_contexts)) {
    throw metadataContractError("keyword_group_contexts");
  }
  if (!isRecord(data.tokens)) {
    throw new Error("HAProxy schema is missing tokens");
  }
  assertAddressPoliciesContract(data.address_policies);
  assertBooleanMatrixValue(data.sample_casts, "sample_casts");
  assertStringArrayRecord(data.keyword_groups, "keyword_groups");
  assertNestedStringArrayRecord(data.keyword_group_contexts, "keyword_group_contexts");
  assertStringArrayRecord(data.tokens, "tokens");
  assertReferencePatternsContract(data.reference_patterns);
  assertSampleFunctionMapContract(data.sample_fetches, "sample_fetches");
  assertSampleFunctionMapContract(data.sample_converters, "sample_converters");
  assertLineLayoutContract(data.line_layout);
}

export function normalizeSchemaData(data: unknown): HaproxySchema {
  const raw = assertRecordShape(data, "schema");
  if (raw.statement_rules === undefined) {
    raw.statement_rules = [];
  }
  if (raw.reference_patterns === undefined) {
    raw.reference_patterns = [];
  }
  if (raw.sample_fetches === undefined) {
    raw.sample_fetches = {};
  }
  if (raw.sample_converters === undefined) {
    raw.sample_converters = {};
  }
  if (raw.keyword_group_contexts === undefined) {
    raw.keyword_group_contexts = {};
  }
  if (raw.line_layout === undefined) {
    raw.line_layout = {};
  }
  assertSchemaContract(data);
  return data;
}
