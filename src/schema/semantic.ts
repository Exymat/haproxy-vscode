import { recordValue, stringArrayValue, stringMapValue } from "./contractHelpers";
import type { HaproxySchema } from "./types";

export function semanticStringList(schema: HaproxySchema, key: string): string[] {
  return stringArrayValue(schema.semantic_groups[key], `semantic_groups.${key}`);
}

export function semanticStringMap(schema: HaproxySchema, key: string): Record<string, string> {
  return stringMapValue(schema.semantic_groups, key, "semantic_groups");
}

export function semanticRecord(schema: HaproxySchema, key: string): Record<string, unknown> {
  return recordValue(schema.semantic_groups, key, "semantic_groups");
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

export function statementRuleGroupForKind(schema: HaproxySchema, kind: string): string | null {
  for (const rule of schema.statement_rules ?? []) {
    if (rule.kind === kind && rule.group) {
      return rule.group;
    }
  }
  return null;
}

export function hasStatementRuleKind(schema: HaproxySchema, kind: string): boolean {
  return (schema.statement_rules ?? []).some((rule) => rule.kind === kind);
}

export function actionCompletionKindSet(schema: HaproxySchema): Set<string> {
  return new Set(Object.keys(semanticStringMap(schema, "completion_kind_to_action_group")));
}

export function aclRefGroupNames(schema: HaproxySchema): string[] {
  return semanticStringList(schema, "acl_ref_groups");
}

export function statementRuleKinds(schema: HaproxySchema): Set<string> {
  return new Set((schema.statement_rules ?? []).map((rule) => rule.kind));
}

export function dynamicActionPrefixes(schema: HaproxySchema): string[] {
  return semanticStringList(schema, "dynamic_action_prefixes");
}
