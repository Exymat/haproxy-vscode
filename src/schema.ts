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

export interface SchemaKeyword {
  name: string;
  sections: string[];
  contexts?: string[];
  signatures: string[];
  sources: string[];
  argument_model?: ArgumentModel;
  arguments?: SchemaArgumentParam[];
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

export interface FixedSlotSpec {
  role: string;
  port?: string | null;
  address_policy?: string | null;
}

export interface StatementRule {
  keyword: string;
  kind: string;
  group?: string;
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

export interface LineLayout {
  prefix_families?: string[];
  prefix_subcommands?: Record<string, string[]>;
  tcp_request_phases?: string[];
  tcp_response_phases?: string[];
  stats_socket_levels?: string[];
}

export interface HaproxySchema {
  version: string;
  sections: Record<string, SchemaSection>;
  keywords: Record<string, SchemaKeyword>;
  keyword_groups: Record<string, string[]>;
  keyword_group_contexts?: Record<string, Record<string, string[]>>;
  statement_rules: StatementRule[];
  sample_fetches: Record<string, SampleFunction>;
  sample_converters: Record<string, SampleFunction>;
  line_layout?: LineLayout;
  tokens: Record<string, string[]>;
}

const schemaCache = new Map<HaproxyVersion, HaproxySchema>();
const sectionKeywordCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
const optionsWithValueCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
const noPrefixKeywordCache = new WeakMap<HaproxySchema, Set<string>>();
const modifierPrefixCache = new WeakMap<HaproxySchema, Set<string>>();
const conditionalTokenCache = new WeakMap<HaproxySchema, Set<string>>();
const namedDefaultsKeywordCache = new WeakMap<HaproxySchema, Set<string>>();
const sampleExpressionNameCache = new WeakMap<
  HaproxySchema,
  { fetchNames: Set<string>; convNames: Set<string> }
>();

const FALLBACK_PREFIX_FAMILIES = [
  "stats",
  "timeout",
  "tcp-check",
  "http-check",
  "capture",
  "tcp-request",
  "tcp-response",
] as const;

const FALLBACK_STATS_SOCKET_LEVELS = ["user", "operator", "admin"] as const;

export function clearSchemaCache(): void {
  schemaCache.clear();
}

export function prefixFamilies(schema: HaproxySchema): string[] {
  return schema.line_layout?.prefix_families ?? [...FALLBACK_PREFIX_FAMILIES];
}

export function prefixSubcommandSet(schema: HaproxySchema, prefix: string): Set<string> {
  const fromLayout = schema.line_layout?.prefix_subcommands?.[prefix.toLowerCase()];
  if (fromLayout) {
    return new Set(fromLayout.map((v) => v.toLowerCase()));
  }
  return buildPrefixSubcommands(Object.keys(schema.keywords), prefix);
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

export function noPrefixKeywordSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, noPrefixKeywordCache, schema.tokens.no_prefix_keywords);
}

export function modifierPrefixSet(schema: HaproxySchema): Set<string> {
  return tokenSetFromSchema(schema, modifierPrefixCache, schema.tokens.modifiers);
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
  const fromLayout =
    kind === "tcp-request"
      ? schema.line_layout?.tcp_request_phases
      : schema.line_layout?.tcp_response_phases;
  if (fromLayout) {
    return new Set(fromLayout.map((v) => v.toLowerCase()));
  }
  return buildPrefixSubcommands(Object.keys(schema.keywords), kind);
}

export function tcpRequestPhaseSet(schema: HaproxySchema): Set<string> {
  return tcpRulePhaseSet(schema, "tcp-request");
}

export function tcpResponsePhaseSet(schema: HaproxySchema): Set<string> {
  return tcpRulePhaseSet(schema, "tcp-response");
}

function legacyTcpRulePhaseSet(schema: HaproxySchema): Set<string> {
  const phases = new Set<string>();
  for (const name of Object.keys(schema.keywords)) {
    for (const prefix of ["tcp-request", "tcp-response"] as const) {
      const needle = `${prefix} `;
      if (name.startsWith(needle)) {
        phases.add(name.slice(needle.length).toLowerCase());
      }
    }
  }
  return phases;
}

/** @deprecated Use tcpRequestPhaseSet / tcpResponsePhaseSet instead. */
export function allTcpRulePhases(schema: HaproxySchema): Set<string> {
  if (schema.line_layout?.tcp_request_phases || schema.line_layout?.tcp_response_phases) {
    return new Set([...tcpRequestPhaseSet(schema), ...tcpResponsePhaseSet(schema)]);
  }
  return legacyTcpRulePhaseSet(schema);
}

function optionTakesValueFallback(option: string): boolean {
  const lower = option.toLowerCase();
  return ["-file", "-path", "-addr", "-port", "-name", "-inter"].some((hint) =>
    lower.includes(hint),
  );
}

export function optionsWithValueSet(schema: HaproxySchema, groupName: string): Set<string> {
  let perSchema = optionsWithValueCache.get(schema);
  if (!perSchema) {
    perSchema = new Map();
    optionsWithValueCache.set(schema, perSchema);
  }
  const cached = perSchema.get(groupName);
  if (cached) {
    return cached;
  }
  const explicitKey = `${groupName}_with_value`;
  const explicit = schema.keyword_groups[explicitKey] ?? [];
  if (explicit.length > 0) {
    const result = new Set(explicit.map((v) => v.toLowerCase()));
    perSchema.set(groupName, result);
    return result;
  }
  const result = new Set<string>();
  for (const option of schema.keyword_groups[groupName] ?? []) {
    if (optionTakesValueFallback(option)) {
      result.add(option.toLowerCase());
    }
  }
  perSchema.set(groupName, result);
  return result;
}

export function statsSocketLevelSet(schema: HaproxySchema): Set<string> {
  const levels = schema.line_layout?.stats_socket_levels ?? [...FALLBACK_STATS_SOCKET_LEVELS];
  return new Set(levels.map((v) => v.toLowerCase()));
}

export function sectionKeywordSet(schema: HaproxySchema, section: string | null): Set<string> {
  if (!section) {
    return new Set();
  }
  let perSchema = sectionKeywordCache.get(schema);
  if (!perSchema) {
    perSchema = new Map();
    sectionKeywordCache.set(schema, perSchema);
  }
  const cached = perSchema.get(section);
  if (cached) {
    return cached;
  }
  const allowed = new Set((schema.sections[section]?.keywords ?? []).map((k) => k.toLowerCase()));
  for (const [name, keyword] of Object.entries(schema.keywords)) {
    if (keyword.sections.includes(section)) {
      allowed.add(name.toLowerCase());
    }
  }
  perSchema.set(section, allowed);
  return allowed;
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
  const raw = fs.readFileSync(schemaPath, "utf-8");
  const data = normalizeSchemaData(JSON.parse(raw) as HaproxySchema);
  schemaCache.set(version, data);
  return data;
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
  const raw = await fs.promises.readFile(schemaPath, "utf-8");
  const data = normalizeSchemaData(JSON.parse(raw) as HaproxySchema);
  schemaCache.set(version, data);
  return data;
}

export function sectionNames(schema: HaproxySchema): string[] {
  return Object.keys(schema.sections).sort();
}

function normalizeSchemaData(data: HaproxySchema): HaproxySchema {
  data.statement_rules = data.statement_rules ?? [];
  data.sample_fetches = data.sample_fetches ?? {};
  data.sample_converters = data.sample_converters ?? {};
  data.keyword_group_contexts = data.keyword_group_contexts ?? {};
  data.line_layout = data.line_layout ?? {};
  return data;
}
