import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { DEFAULT_HAPROXY_VERSION, HaproxyVersion } from "./version";

export interface SchemaSection {
  name: string;
  keywords: string[];
}

export interface ArgumentSlot {
  optional?: boolean;
  variadic?: boolean;
  enum?: string[];
  value_kind?: string;
}

export interface ArgumentModel {
  min_args: number;
  max_args: number | null;
  slots: ArgumentSlot[];
}

export interface SchemaArgumentValue {
  name: string;
  description: string;
}

export interface SchemaArgumentParam {
  parameter: string;
  description: string;
  values: SchemaArgumentValue[];
}

export interface SchemaKeywordVariant {
  chapter: string;
  sections: string[];
  contexts?: string[];
  signatures: string[];
  argument_model?: ArgumentModel;
  arguments?: SchemaArgumentParam[];
}

export interface LineOptionSemantic {
  parent_kind: string;
  option_group: string;
  chapter: string;
  takes_value?: boolean;
}

export interface SchemaKeyword {
  name: string;
  sections: string[];
  contexts?: string[];
  signatures: string[];
  sources: string[];
  variants?: SchemaKeywordVariant[];
  argument_model?: ArgumentModel;
  arguments?: SchemaArgumentParam[];
  line_option_semantics?: LineOptionSemantic[];
}

export interface SampleFunction {
  name: string;
  args: string[];
  out_type: string;
  in_type?: string;
  contexts?: boolean[];
  min_args?: number;
  max_args?: number | null;
  signature?: string;
  description?: string;
  chapter?: string;
  deprecated?: boolean;
}

export interface LogformatAlias {
  name: string;
  field_name: string;
  sample_fetch: string;
  type: string;
  restrictions: string;
  category: string;
}

export interface FixedSlotSpec {
  role: string;
  port?: string | null;
  address_policy?: string | null;
}

export interface SchemaAddressPolicy {
  portOk: boolean;
  portMandatory: boolean;
  portRange: boolean;
  portOffset: boolean;
}

export interface StatementRule {
  keyword: string;
  kind: string;
  group?: string;
  match_tokens?: string[];
  minimum_token_index?: number;
  value_token_index?: number;
  action_token_index?: number;
  phase_token_index?: number;
  nested_start_index?: number;
  prefix?: string;
  sections?: string[];
  fixed_slots?: FixedSlotSpec[];
  reference_kind?: string;
  definition_kind?: string;
  symbol_name_token_index?: number;
}

export interface ReferencePattern {
  match_tokens: string[];
  reference_kind: string;
  target_token_index: number;
  scope?: "global" | "section";
  split?: string;
}

export interface LineLayout {
  prefix_families?: string[];
  prefix_subcommands?: Record<string, string[]>;
  tcp_request_phases?: string[];
  tcp_response_phases?: string[];
  stats_socket_levels?: string[];
  section_headers?: string[];
}

export interface LogformatSlot {
  kind: "line_tail" | "prefix";
  directive?: string;
  prefix?: string;
  skip?: number;
}

export interface HaproxySchema {
  version: string;
  sections: Record<string, SchemaSection>;
  keywords: Record<string, SchemaKeyword>;
  address_policies: Record<string, SchemaAddressPolicy>;
  sample_types: string[];
  sample_casts: boolean[][];
  symbols: Record<string, unknown>;
  semantic_groups: Record<string, unknown>;
  validation_rules: Record<string, unknown>;
  keyword_groups: Record<string, string[]>;
  keyword_group_contexts?: Record<string, Record<string, string[]>>;
  statement_rules: StatementRule[];
  reference_patterns?: ReferencePattern[];
  sample_fetches: Record<string, SampleFunction>;
  sample_converters: Record<string, SampleFunction>;
  logformat_aliases?: Record<string, LogformatAlias>;
  logformat_slots?: LogformatSlot[];
  line_layout?: LineLayout;
  tokens: Record<string, string[]>;
}

const schemaCache = new Map<HaproxyVersion, HaproxySchema>();

interface SectionKeywordCacheEntry {
  allowed: Set<string>;
  hasOptionKeywords: boolean;
}

const sectionKeywordCache = new WeakMap<HaproxySchema, Map<string, SectionKeywordCacheEntry>>();
const keywordGroupSetCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
const lineOptionSetCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
const optionsWithValueCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
const noPrefixKeywordCache = new WeakMap<HaproxySchema, Set<string>>();
const modifierPrefixCache = new WeakMap<HaproxySchema, Set<string>>();
const macroTokenCache = new WeakMap<HaproxySchema, Set<string>>();
const conditionalTokenCache = new WeakMap<HaproxySchema, Set<string>>();
const namedDefaultsKeywordCache = new WeakMap<HaproxySchema, Set<string>>();
const sampleExpressionNameCache = new WeakMap<
  HaproxySchema,
  { fetchNames: Set<string>; convNames: Set<string> }
>();
const prefixSubcommandCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
const prefixFamilyCache = new WeakMap<HaproxySchema, Set<string>>();
const tcpRequestPhaseCache = new WeakMap<HaproxySchema, Set<string>>();
const tcpResponsePhaseCache = new WeakMap<HaproxySchema, Set<string>>();
const statsSocketLevelCache = new WeakMap<HaproxySchema, Set<string>>();
const sectionHeaderSetCache = new WeakMap<HaproxySchema, Set<string>>();
const sortedSectionHeaderCache = new WeakMap<HaproxySchema, string[]>();
const symbolStringSetCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
const logFormatDirectiveKeywordCache = new WeakMap<HaproxySchema, Set<string>>();

function metadataContractError(path: string): Error {
  return new Error(`HAProxy schema is missing required generated metadata: ${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRecordShape(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw metadataContractError(path);
  }
  return value;
}

function recordValue(
  data: Record<string, unknown>,
  key: string,
  namespace: string,
): Record<string, unknown> {
  const value = data[key];
  return assertRecordShape(value, `${namespace}.${key}`);
}

function stringArrayValue(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw metadataContractError(path);
  }
  return value as string[];
}

function assertStringValue(value: unknown, path: string): void {
  if (typeof value !== "string") {
    throw metadataContractError(path);
  }
}

function assertOptionalStringValue(value: unknown, path: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw metadataContractError(path);
  }
}

function assertOptionalStringArrayValue(value: unknown, path: string): void {
  if (value !== undefined) {
    stringArrayValue(value, path);
  }
}

function assertOptionalNumberValue(value: unknown, path: string): void {
  if (value !== undefined && value !== null && typeof value !== "number") {
    throw metadataContractError(path);
  }
}

function assertOptionalBooleanValue(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw metadataContractError(path);
  }
}

function assertOptionalBooleanArrayValue(value: unknown, path: string): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) || value.some((item) => typeof item !== "boolean"))
  ) {
    throw metadataContractError(path);
  }
}

function assertStringArrayRecord(value: unknown, path: string): void {
  const record = assertRecordShape(value, path);
  for (const [key, item] of Object.entries(record)) {
    stringArrayValue(item, `${path}.${key}`);
  }
}

function assertNestedStringArrayRecord(value: unknown, path: string): void {
  const record = assertRecordShape(value, path);
  for (const [key, item] of Object.entries(record)) {
    assertStringArrayRecord(item, `${path}.${key}`);
  }
}

function assertBooleanMatrixValue(value: unknown, path: string): void {
  /* v8 ignore next -- validateSchemaContract checks this before calling the matrix validator. */
  if (!Array.isArray(value)) {
    throw metadataContractError(path);
  }
  value.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.some((item) => typeof item !== "boolean")) {
      throw metadataContractError(`${path}.${rowIndex}`);
    }
  });
}

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

function stringMapValue(
  data: Record<string, unknown>,
  key: string,
  namespace: string,
): Record<string, string> {
  const record = recordValue(data, key, namespace);
  if (Object.values(record).some((value) => typeof value !== "string")) {
    throw metadataContractError(`${namespace}.${key}`);
  }
  return record as Record<string, string>;
}

export function schemaAddressPolicies(schema: HaproxySchema): Record<string, SchemaAddressPolicy> {
  if (!schema.address_policies || Object.keys(schema.address_policies).length === 0) {
    throw metadataContractError("address_policies");
  }
  return schema.address_policies;
}

export function schemaAddressPolicy(schema: HaproxySchema, name: string): SchemaAddressPolicy {
  const policy = schemaAddressPolicies(schema)[name];
  if (!policy) {
    throw metadataContractError(`address_policies.${name}`);
  }
  return policy;
}

export function schemaSampleTypes(schema: HaproxySchema): string[] {
  const types = stringArrayValue(schema.sample_types, "sample_types");
  if (types.length === 0) {
    throw metadataContractError("sample_types");
  }
  return types;
}

export function schemaSampleCasts(schema: HaproxySchema): boolean[][] {
  if (!Array.isArray(schema.sample_casts) || schema.sample_casts.length === 0) {
    throw metadataContractError("sample_casts");
  }
  return schema.sample_casts;
}

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

export function semanticStringList(schema: HaproxySchema, key: string): string[] {
  return stringArrayValue(schema.semantic_groups[key], `semantic_groups.${key}`);
}

export function semanticStringMap(schema: HaproxySchema, key: string): Record<string, string> {
  return stringMapValue(schema.semantic_groups, key, "semantic_groups");
}

export function semanticRecord(schema: HaproxySchema, key: string): Record<string, unknown> {
  return recordValue(schema.semantic_groups, key, "semantic_groups");
}

export function validationStringList(schema: HaproxySchema, key: string): string[] {
  return stringArrayValue(schema.validation_rules[key], `validation_rules.${key}`);
}

export function validationStringMap(schema: HaproxySchema, key: string): Record<string, string> {
  return stringMapValue(schema.validation_rules, key, "validation_rules");
}

export function validationRecord(schema: HaproxySchema, key: string): Record<string, unknown> {
  return recordValue(schema.validation_rules, key, "validation_rules");
}

export function actionGroupNames(schema: HaproxySchema): string[] {
  return semanticStringList(schema, "action_groups");
}

export function deprecatedActionGroupNames(schema: HaproxySchema): string[] {
  return semanticStringList(schema, "deprecated_action_groups");
}

export function actionGroupForCompletionKind(schema: HaproxySchema, kind: string): string | null {
  return semanticStringMap(schema, "completion_kind_to_action_group")[kind] ?? null;
}

export function lineOptionGroupForKind(schema: HaproxySchema, kind: string): string | null {
  return semanticStringMap(schema, "line_option_group_for_kind")[kind] ?? null;
}

export function sampleExpressionGroupForKind(schema: HaproxySchema, kind: string): string | null {
  return semanticStringMap(schema, "sample_expression_group_for_kind")[kind] ?? null;
}

export function dynamicActionPrefixes(schema: HaproxySchema): string[] {
  return semanticStringList(schema, "dynamic_action_prefixes");
}

export function logformatStopTokenSet(schema: HaproxySchema): Set<string> {
  return new Set(validationStringList(schema, "logformat_stop_tokens"));
}

export function clearSchemaCache(): void {
  schemaCache.clear();
}

export function prefixFamilies(schema: HaproxySchema): string[] {
  return schema.line_layout?.prefix_families ?? [];
}

export function prefixFamilySet(schema: HaproxySchema): Set<string> {
  const cached = prefixFamilyCache.get(schema);
  if (cached) {
    return cached;
  }
  const result = new Set(prefixFamilies(schema).map((value) => value.toLowerCase()));
  prefixFamilyCache.set(schema, result);
  return result;
}

export function prefixSubcommandSet(schema: HaproxySchema, prefix: string): Set<string> {
  const key = prefix.toLowerCase();
  return prefixSubcommandCached(schema, key, () => {
    const fromLayout = schema.line_layout?.prefix_subcommands?.[key];
    return fromLayout
      ? new Set(fromLayout.map((v) => v.toLowerCase()))
      : buildPrefixSubcommands(Object.keys(schema.keywords), prefix);
  });
}

export function buildPrefixSubcommands(keywords: Iterable<string>, prefix: string): Set<string> {
  const needle = `${prefix.toLowerCase()} `;
  const subs = new Set<string>();
  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();
    if (lower.startsWith(needle)) {
      subs.add(lower.slice(needle.length));
    }
  }
  return subs;
}

function tokenSetFromSchema(
  schema: HaproxySchema,
  cache: WeakMap<HaproxySchema, Set<string>>,
  values: string[] | undefined,
): Set<string> {
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  const result = new Set((values ?? []).map((v) => v.toLowerCase()));
  cache.set(schema, result);
  return result;
}

function perSchemaMapCache<V>(
  outerCache: WeakMap<HaproxySchema, Map<string, V>>,
): (schema: HaproxySchema, key: string, build: () => V) => V {
  return (schema, key, build) => {
    let perSchema = outerCache.get(schema);
    if (!perSchema) {
      perSchema = new Map();
      outerCache.set(schema, perSchema);
    }
    const cached = perSchema.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = build();
    perSchema.set(key, result);
    return result;
  };
}

const keywordGroupSetCached = perSchemaMapCache(keywordGroupSetCache);
const lineOptionSetCached = perSchemaMapCache(lineOptionSetCache);
const optionsWithValueCached = perSchemaMapCache(optionsWithValueCache);
const prefixSubcommandCached = perSchemaMapCache(prefixSubcommandCache);

export function noPrefixKeywordSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, noPrefixKeywordCache, schema.tokens.no_prefix_keywords);
}

export function modifierPrefixSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, modifierPrefixCache, schema.tokens.modifiers);
}

export function macroTokenSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, macroTokenCache, schema.tokens.macros);
}

export function conditionalTokenSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, conditionalTokenCache, schema.tokens.conditionals);
}

export function namedDefaultsKeywordSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(
    schema,
    namedDefaultsKeywordCache,
    schema.tokens.named_defaults_keywords,
  );
}

export function sampleExpressionNameSets(schema: HaproxySchema): {
  fetchNames: Set<string>;
  convNames: Set<string>;
} {
  const cached = sampleExpressionNameCache.get(schema);
  if (cached) {
    return cached;
  }
  const fetchNames = new Set(
    Object.keys(schema.sample_fetches ?? {}).map((name) => name.toLowerCase()),
  );
  const convNames = new Set(
    Object.keys(schema.sample_converters ?? {}).map((name) => name.toLowerCase()),
  );
  for (const name of schema.keyword_groups.sample_fetches ?? []) {
    fetchNames.add(name.toLowerCase());
  }
  for (const name of schema.keyword_groups.sample_converters ?? []) {
    convNames.add(name.toLowerCase());
  }
  const result = { fetchNames, convNames };
  sampleExpressionNameCache.set(schema, result);
  return result;
}

export function tcpRulePhaseSet(
  schema: HaproxySchema,
  kind: "tcp-request" | "tcp-response",
): Set<string> {
  const cache = kind === "tcp-request" ? tcpRequestPhaseCache : tcpResponsePhaseCache;
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  const fromLayout =
    kind === "tcp-request"
      ? schema.line_layout?.tcp_request_phases
      : schema.line_layout?.tcp_response_phases;
  const result = fromLayout
    ? new Set(fromLayout.map((v) => v.toLowerCase()))
    : buildPrefixSubcommands(Object.keys(schema.keywords), kind);
  cache.set(schema, result);
  return result;
}

export function tcpRequestPhaseSet(schema: HaproxySchema): Set<string> {
  return tcpRulePhaseSet(schema, "tcp-request");
}

export function tcpResponsePhaseSet(schema: HaproxySchema): Set<string> {
  return tcpRulePhaseSet(schema, "tcp-response");
}

export function optionsWithValueSet(schema: HaproxySchema, groupName: string): Set<string> {
  return optionsWithValueCached(schema, groupName, () => {
    const explicitKey = `${groupName}_with_value`;
    const explicit = schema.keyword_groups[explicitKey] ?? [];
    return new Set(explicit.map((v) => v.toLowerCase()));
  });
}

export function keywordGroupSet(schema: HaproxySchema, groupName: string): Set<string> {
  return keywordGroupSetCached(
    schema,
    groupName,
    () => new Set((schema.keyword_groups[groupName] ?? []).map((v) => v.toLowerCase())),
  );
}

export function lineOptionSet(schema: HaproxySchema, groupName: string): Set<string> {
  return lineOptionSetCached(schema, groupName, () => {
    const result = new Set(keywordGroupSet(schema, groupName));
    for (const option of optionsWithValueSet(schema, groupName)) {
      result.add(option);
    }
    return result;
  });
}

export function statsSocketLevelSet(schema: HaproxySchema): Set<string> {
  const cached = statsSocketLevelCache.get(schema);
  if (cached) {
    return cached;
  }
  const levels = schema.line_layout?.stats_socket_levels ?? [];
  const result = new Set(levels.map((v) => v.toLowerCase()));
  statsSocketLevelCache.set(schema, result);
  return result;
}

function buildSectionKeywordEntry(
  schema: HaproxySchema,
  section: string,
): SectionKeywordCacheEntry {
  const allowed = new Set((schema.sections[section]?.keywords ?? []).map((k) => k.toLowerCase()));
  let hasOptionKeywords = false;
  for (const [name, keyword] of Object.entries(schema.keywords)) {
    if (keyword.sections.includes(section)) {
      allowed.add(name.toLowerCase());
    }
  }
  for (const keyword of allowed) {
    if (keyword.startsWith("option ") || keyword.startsWith("no option")) {
      hasOptionKeywords = true;
      break;
    }
  }
  return { allowed, hasOptionKeywords };
}

function sectionKeywordEntry(schema: HaproxySchema, section: string): SectionKeywordCacheEntry {
  let perSchema = sectionKeywordCache.get(schema);
  if (!perSchema) {
    perSchema = new Map();
    sectionKeywordCache.set(schema, perSchema);
  }
  const cached = perSchema.get(section);
  if (cached) {
    return cached;
  }
  const entry = buildSectionKeywordEntry(schema, section);
  perSchema.set(section, entry);
  return entry;
}

export function sectionKeywordSet(schema: HaproxySchema, section: string | null): Set<string> {
  if (!section) {
    return new Set();
  }
  return sectionKeywordEntry(schema, section).allowed;
}

export function sectionHasOptionKeywords(schema: HaproxySchema, section: string | null): boolean {
  if (!section) {
    return false;
  }
  return sectionKeywordEntry(schema, section).hasOptionKeywords;
}

export function loadSchema(
  context: vscode.ExtensionContext,
  version: HaproxyVersion = DEFAULT_HAPROXY_VERSION,
): HaproxySchema {
  const cached = schemaCache.get(version);
  if (cached) {
    return cached;
  }
  const schemaPath = path.join(context.extensionPath, "schemas", `haproxy-${version}.schema.json`);
  try {
    const raw = fs.readFileSync(schemaPath, "utf-8");
    const data = normalizeSchemaData(JSON.parse(raw) as HaproxySchema);
    schemaCache.set(version, data);
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load HAProxy schema for ${version} from ${schemaPath}: ${message}`, {
      cause: error,
    });
  }
}

export async function loadSchemaAsync(
  context: vscode.ExtensionContext,
  version: HaproxyVersion = DEFAULT_HAPROXY_VERSION,
): Promise<HaproxySchema> {
  const cached = schemaCache.get(version);
  if (cached) {
    return cached;
  }
  const schemaPath = path.join(context.extensionPath, "schemas", `haproxy-${version}.schema.json`);
  try {
    const raw = await fs.promises.readFile(schemaPath, "utf-8");
    const data = normalizeSchemaData(JSON.parse(raw) as HaproxySchema);
    schemaCache.set(version, data);
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load HAProxy schema for ${version} from ${schemaPath}: ${message}`, {
      cause: error,
    });
  }
}

export function sectionNames(schema: HaproxySchema): string[] {
  return Object.keys(schema.sections).sort();
}

export function sectionHeaderSet(schema: HaproxySchema): Set<string> {
  const cached = sectionHeaderSetCache.get(schema);
  if (cached) {
    return cached;
  }
  const fromLayout = schema.line_layout?.section_headers;
  const headers =
    fromLayout && fromLayout.length > 0
      ? [...new Set([...fromLayout, ...sectionNames(schema)])]
      : sectionNames(schema);
  const set = new Set(headers.map((header) => header.toLowerCase()));
  sectionHeaderSetCache.set(schema, set);
  return set;
}

export function sortedSectionHeaders(schema: HaproxySchema): string[] {
  const cached = sortedSectionHeaderCache.get(schema);
  if (cached) {
    return cached;
  }
  const sorted = [...sectionHeaderSet(schema)].sort();
  sortedSectionHeaderCache.set(schema, sorted);
  return sorted;
}

export function logFormatDirectiveKeywordSet(schema: HaproxySchema): Set<string> {
  const cached = logFormatDirectiveKeywordCache.get(schema);
  if (cached) {
    return cached;
  }
  const keywords = new Set<string>();
  for (const slot of schema.logformat_slots ?? []) {
    if (slot.directive) {
      keywords.add(slot.directive.toLowerCase());
    }
  }
  logFormatDirectiveKeywordCache.set(schema, keywords);
  return keywords;
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
    if (pattern.scope !== undefined && pattern.scope !== "global" && pattern.scope !== "section") {
      throw metadataContractError(`${path}.scope`);
    }
    assertOptionalStringValue(pattern.split, `${path}.split`);
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

function assertSchemaContract(data: HaproxySchema): void {
  if (!data.version || typeof data.version !== "string") {
    throw new Error("HAProxy schema is missing a version string");
  }
  if (!isRecord(data.sections)) {
    throw new Error("HAProxy schema is missing sections");
  }
  if (!isRecord(data.keywords)) {
    throw new Error("HAProxy schema is missing keywords");
  }
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

function normalizeSchemaData(data: HaproxySchema): HaproxySchema {
  const raw = data as unknown as Record<string, unknown>;
  if (raw.statement_rules === undefined) {
    data.statement_rules = [];
  }
  if (raw.reference_patterns === undefined) {
    data.reference_patterns = [];
  }
  if (raw.sample_fetches === undefined) {
    data.sample_fetches = {};
  }
  if (raw.sample_converters === undefined) {
    data.sample_converters = {};
  }
  if (raw.keyword_group_contexts === undefined) {
    data.keyword_group_contexts = {};
  }
  if (raw.line_layout === undefined) {
    data.line_layout = {};
  }
  assertSchemaContract(data);
  return data;
}
