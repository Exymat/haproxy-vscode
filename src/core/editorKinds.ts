/** Editor-only completion kinds not derived from statement_rules. */
export const EDITOR_KINDS = {
  section: "section",
  sectionHeaderModifier: "section-header-modifier",
  directive: "directive",
  directiveArgument: "directive-argument",
  expressionFetch: "expression-fetch",
  expressionConverter: "expression-converter",
} as const;

export type CompletionKind = string;

export type SymbolKind = string;
