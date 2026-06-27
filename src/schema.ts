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

export interface SchemaKeyword {
  name: string;
  sections: string[];
  contexts?: string[];
  signatures: string[];
  sources: string[];
  variants?: SchemaKeywordVariant[];
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
  keyword_groups: Record<string, string[]>;
  keyword_group_contexts?: Record<string, Record<string, string[]>>;
  statement_rules: StatementRule[];
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
const tcpRequestPhaseCache = new WeakMap<HaproxySchema, Set<string>>();
const tcpResponsePhaseCache = new WeakMap<HaproxySchema, Set<string>>();
const statsSocketLevelCache = new WeakMap<HaproxySchema, Set<string>>();

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

function optionTakesValueFallback(option: string): boolean {
  const lower = option.toLowerCase();
  return ["-file", "-path", "-addr", "-port", "-name", "-inter"].some((hint) =>
    lower.includes(hint),
  );
}

export function optionsWithValueSet(schema: HaproxySchema, groupName: string): Set<string> {
  return optionsWithValueCached(schema, groupName, () => {
    const explicitKey = `${groupName}_with_value`;
    const explicit = schema.keyword_groups[explicitKey] ?? [];
    if (explicit.length > 0) {
      return new Set(explicit.map((v) => v.toLowerCase()));
    }
    const result = new Set<string>();
    for (const option of schema.keyword_groups[groupName] ?? []) {
      if (optionTakesValueFallback(option)) {
        result.add(option.toLowerCase());
      }
    }
    return result;
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
  const levels = schema.line_layout?.stats_socket_levels ?? [...FALLBACK_STATS_SOCKET_LEVELS];
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

function normalizeSchemaData(data: HaproxySchema): HaproxySchema {
  data.statement_rules = data.statement_rules ?? [];
  data.sample_fetches = data.sample_fetches ?? {};
  data.sample_converters = data.sample_converters ?? {};
  data.keyword_group_contexts = data.keyword_group_contexts ?? {};
  data.line_layout = data.line_layout ?? {};
  return data;
}
