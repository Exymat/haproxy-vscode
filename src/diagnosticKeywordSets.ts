import { HaproxySchema, validationStringList } from "./schema";

const argumentModelSkipCache = new WeakMap<HaproxySchema, Set<string>>();
const nestedDiagnosticCache = new WeakMap<HaproxySchema, Set<string>>();
const statementRuleKeywordCache = new WeakMap<HaproxySchema, Set<string>>();

function cachedValidationSet(
  schema: HaproxySchema,
  cache: WeakMap<HaproxySchema, Set<string>>,
  key: string,
): Set<string> {
  let cached = cache.get(schema);
  if (!cached) {
    cached = new Set(validationStringList(schema, key));
    cache.set(schema, cached);
  }
  return cached;
}

export function argumentModelSkipKeywordSet(schema: HaproxySchema): Set<string> {
  return cachedValidationSet(schema, argumentModelSkipCache, "argument_model_skip_keywords");
}

export function nestedDiagnosticKeywordSet(schema: HaproxySchema): Set<string> {
  return cachedValidationSet(schema, nestedDiagnosticCache, "nested_diagnostic_keywords");
}

export function statementRuleKeywordSet(schema: HaproxySchema): Set<string> {
  return cachedValidationSet(schema, statementRuleKeywordCache, "statement_rule_keywords");
}
