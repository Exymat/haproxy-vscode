/** Re-exports conditional directive helpers from the parser layer. */
export {
  conditionalBlocksDocsUrl,
  conditionalBranchInfoForDocument,
  isConditionalBlockDirective,
  isConditionalOrStatusDirective,
  isInactiveConditionalBranch,
  lookupConditionalDirective,
} from "../parser/conditionalDirectives";
export type {
  ConditionalBranchState,
  ConditionalDirectiveInfo,
  ConditionalLineInfo,
} from "../parser/conditionalDirectives";
