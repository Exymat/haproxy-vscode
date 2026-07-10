// Public barrel for external consumers and tests that need the full schema surface.
// Production code should import from ./schema/<module> directly.
export type {
  ArgumentModel,
  ArgumentSlot,
  FixedSlotSpec,
  HaproxySchema,
  LineLayout,
  LineOptionSemantic,
  LogformatAlias,
  LogformatSlot,
  ReferencePattern,
  SampleFunction,
  SchemaAddressPolicy,
  SchemaArgumentParam,
  SchemaArgumentValue,
  SchemaKeyword,
  SchemaKeywordVariant,
  SchemaSection,
  StatementRule,
} from "./types";

export { clearSchemaCache, loadSchema, loadSchemaAsync } from "./load";
export {
  bindDetectKeywordSet,
  entryPointSectionSet,
  namedSectionSet,
  symbolRecord,
  symbolStringList,
  symbolStringMap,
  symbolStringSet,
} from "./symbols";
export {
  aclRefGroupNames,
  actionCompletionKindSet,
  actionGroupForCompletionKind,
  actionGroupNames,
  deprecatedActionGroupNames,
  dynamicActionPrefixes,
  hasStatementRuleKind,
  lineOptionGroupForKind,
  sampleExpressionGroupForKind,
  semanticRecord,
  semanticStringList,
  semanticStringMap,
  statementRuleGroupForKind,
  statementRuleKinds,
} from "./semantic";
export {
  addressDirectivePolicyKey,
  logformatStopTokenSet,
  validationObjectArray,
  validationRecord,
  validationStringList,
  validationStringMap,
  validationStringValue,
} from "./validation";
export {
  schemaAddressPolicies,
  schemaAddressPolicy,
  schemaSampleCasts,
  schemaSampleTypes,
} from "./samples";
export {
  buildPrefixSubcommands,
  keywordGroupSet,
  lineOptionSet,
  optionsWithValueSet,
  prefixSubcommandSet,
  sectionHasOptionKeywords,
  sectionKeywordSet,
} from "./keywords";
export {
  logFormatDirectiveKeywordSet,
  prefixFamilies,
  prefixFamilySet,
  sectionHeaderSet,
  sectionNames,
  sortedSectionHeaders,
  statsSocketLevelSet,
  tcpRequestPhaseSet,
  tcpResponsePhaseSet,
  tcpRulePhaseSet,
} from "./layout";
export {
  conditionalTokenSet,
  macroTokenSet,
  modifierPrefixSet,
  namedDefaultsKeywordSet,
  noPrefixKeywordSet,
  sampleExpressionNameSets,
} from "./tokens";
