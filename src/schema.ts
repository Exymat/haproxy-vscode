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
}

export interface FixedSlotSpec {
  role: string;
  port?: string | null;
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

export interface HaproxySchema {
  version: string;
  sections: Record<string, SchemaSection>;
  keywords: Record<string, SchemaKeyword>;
  keyword_groups: Record<string, string[]>;
  statement_rules: StatementRule[];
  sample_fetches: Record<string, SampleFunction>;
  sample_converters: Record<string, SampleFunction>;
  tokens: Record<string, string[]>;
}

const schemaCache = new Map<HaproxyVersion, HaproxySchema>();
const sectionKeywordCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();
const optionsWithValueCache = new WeakMap<HaproxySchema, Map<string, Set<string>>>();

const VALUE_OPTION_HINTS = [
  "-file",
  "-path",
  "-pass",
  "-list",
  "-addr",
  "-port",
  "-net",
  "-opts",
  "-prefer",
  "-name",
  "-tag",
  "-format",
  "-header",
  "-backend",
  "-server",
  "-conn",
  "-delay",
  "-limit",
  "-inter",
  "-key",
] as const;

const VALUE_OPTION_EXACT = new Set([
  "crt",
  "name",
  "alpn",
  "ciphers",
  "ciphersuites",
  "curves",
  "npn",
  "proto",
  "verify",
  "verifyhost",
  "sni",
  "mss",
  "nbconn",
  "nice",
  "uid",
  "gid",
  "group",
  "interface",
  "namespace",
  "thread",
  "process",
  "shards",
  "sigalgs",
  "addr",
  "path",
  "command",
  "redir",
  "resolvers",
  "weight",
  "port",
  "mode",
  "level",
  "label",
  "id",
  "ws",
  "shard",
  "hash-key",
  "monitor",
  "description",
  "agent-port",
  "agent-inter",
  "agent-send",
  "pool-max-conn",
  "pool-low-conn",
  "pool-purge-delay",
  "pool-conn-name",
  "log-proto",
  "log-bufsize",
  "max-reuse",
  "slowstart",
  "maxqueue",
  "minconn",
  "maxconn",
  "quic-cc-algo",
  "severity-output",
  "tls-ticket-keys",
  "client-sigalgs",
  "proxy-v2-options",
  "send-proxy-v2",
  "default-crt",
  "ca-verify-file",
  "ca-sign-file",
  "ca-sign-pass",
  "crl-file",
  "crt-list",
  "crt-ignore-err",
  "ca-ignore-err",
]);

const STATS_SOCKET_LEVELS = new Set(["user", "operator", "admin"]);

export function clearSchemaCache(): void {
  schemaCache.clear();
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

export function noPrefixKeywordSet(schema: HaproxySchema): Set<string> {
  return new Set((schema.tokens.no_prefix_keywords ?? []).map((k) => k.toLowerCase()));
}

export function modifierPrefixSet(schema: HaproxySchema): Set<string> {
  return new Set((schema.tokens.modifiers ?? []).map((k) => k.toLowerCase()));
}

export function conditionalTokenSet(schema: HaproxySchema): Set<string> {
  return new Set((schema.tokens.conditionals ?? []).map((k) => k.toLowerCase()));
}

export function namedDefaultsKeywordSet(schema: HaproxySchema): Set<string> {
  return new Set((schema.tokens.named_defaults_keywords ?? []).map((k) => k.toLowerCase()));
}

export function tcpRulePhaseSet(schema: HaproxySchema): Set<string> {
  const phases = new Set<string>();
  for (const name of Object.keys(schema.keywords)) {
    for (const prefix of ["tcp-request", "tcp-response"]) {
      const needle = `${prefix} `;
      if (name.startsWith(needle)) {
        phases.add(name.slice(needle.length).toLowerCase());
      }
    }
  }
  return phases;
}

function optionTakesValue(option: string): boolean {
  const lower = option.toLowerCase();
  if (VALUE_OPTION_EXACT.has(lower)) {
    return true;
  }
  return VALUE_OPTION_HINTS.some((hint) => lower.includes(hint));
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
  const result = new Set<string>();
  for (const option of schema.keyword_groups[groupName] ?? []) {
    if (optionTakesValue(option)) {
      result.add(option.toLowerCase());
    }
  }
  perSchema.set(groupName, result);
  return result;
}

export function statsSocketLevelSet(): Set<string> {
  return STATS_SOCKET_LEVELS;
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
  version: HaproxyVersion = DEFAULT_HAPROXY_VERSION
): HaproxySchema {
  const cached = schemaCache.get(version);
  if (cached) {
    return cached;
  }
  const schemaPath = path.join(context.extensionPath, "schemas", `haproxy-${version}.schema.json`);
  const raw = fs.readFileSync(schemaPath, "utf-8");
  const data = JSON.parse(raw) as HaproxySchema;
  data.statement_rules = data.statement_rules ?? [];
  data.sample_fetches = data.sample_fetches ?? {};
  data.sample_converters = data.sample_converters ?? {};
  schemaCache.set(version, data);
  return data;
}

export function sectionNames(schema: HaproxySchema): string[] {
  return Object.keys(schema.sections).sort();
}
