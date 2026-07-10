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
  symbol_name_token_from_index?: number;
}

export interface ReferencePattern {
  match_tokens: string[];
  reference_kind: string;
  target_token_index: number;
  scope?: "global" | "section" | "section-header";
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
