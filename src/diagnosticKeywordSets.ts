import { HaproxySchema, validationStringList } from "./schema";

export function argumentModelSkipKeywordSet(schema: HaproxySchema): Set<string> {
  return new Set(validationStringList(schema, "argument_model_skip_keywords"));
}

export function nestedDiagnosticKeywordSet(schema: HaproxySchema): Set<string> {
  return new Set(validationStringList(schema, "nested_diagnostic_keywords"));
}

export function statementRuleKeywordSet(schema: HaproxySchema): Set<string> {
  return new Set(validationStringList(schema, "statement_rule_keywords"));
}
