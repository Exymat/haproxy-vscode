/** Editor-only completion kinds not derived from statement_rules. */
export const EDITOR_KINDS = {
  section: "section",
  sectionHeaderModifier: "section-header-modifier",
  directive: "directive",
  directiveArgument: "directive-argument",
  expressionFetch: "expression-fetch",
  expressionConverter: "expression-converter",
} as const;

export type EditorCompletionKind = (typeof EDITOR_KINDS)[keyof typeof EDITOR_KINDS];

/** Statement rule and semantic-group kinds emitted by bundled schemas. */
export const SCHEMA_COMPLETION_KINDS = [
  "acl-criterion",
  "bind",
  "directive",
  "filter",
  "http-after-response",
  "http-request",
  "http-response",
  "option",
  "quic-initial",
  "server",
  "tcp-request",
  "tcp-response",
] as const;

export type SchemaCompletionKind = (typeof SCHEMA_COMPLETION_KINDS)[number];

export type CompletionKind = EditorCompletionKind | SchemaCompletionKind;

/** Symbol kinds emitted by bundled schema metadata and statement rules. */
export const SCHEMA_SYMBOL_KINDS = [
  "acl",
  "acme",
  "cache",
  "crt-store",
  "defaults-profile",
  "environment-variable",
  "fcgi-app",
  "filter",
  "healthcheck",
  "http-errors",
  "log-forward",
  "log-profile",
  "mailer",
  "mailers",
  "nameserver",
  "peer",
  "peers",
  "program",
  "proxy-section",
  "resolvers",
  "ring",
  "server",
  "server-template",
  "traces",
  "userlist",
  "variable",
] as const;

export type SchemaSymbolKind = (typeof SCHEMA_SYMBOL_KINDS)[number];
export type SymbolKind = SchemaSymbolKind;

const symbolKindSet = new Set<string>(SCHEMA_SYMBOL_KINDS);

export function isSymbolKind(value: string): value is SymbolKind {
  return symbolKindSet.has(value);
}

/** HAProxy runtime modes declared in schema.symbols.runtime_modes. */
export const RUNTIME_MODES = ["haterm", "http", "log", "spop", "tcp"] as const;

export type RuntimeMode = (typeof RUNTIME_MODES)[number];
