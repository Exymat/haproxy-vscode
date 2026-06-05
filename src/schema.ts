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

export function namedDefaultsKeywordSet(schema: HaproxySchema): Set<string> {
  return new Set((schema.tokens.named_defaults_keywords ?? []).map((k) => k.toLowerCase()));
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
