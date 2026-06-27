/** Keywords handled by statement rules or nested diagnostics — skip generic argument_model validation. */
export const ARGUMENT_MODEL_SKIP_KEYWORDS = new Set([
  "bind",
  "server",
  "acl",
  "option",
  "stats",
  "http-request",
  "http-response",
  "tcp-request",
  "tcp-response",
  "http-after-response",
  "http-check",
  "tcp-check",
]);

/** First-token keywords routed to nested/unknown keyword diagnostics. */
export const NESTED_DIAGNOSTIC_KEYWORDS = new Set([
  "option",
  "no",
  "acl",
  "stats",
  "tcp-request",
  "tcp-response",
  "http-request",
  "http-response",
  "http-after-response",
  "mode",
  "balance",
  "bind",
  "server",
]);

/** Keywords validated by statement rules — nested diagnostics return early with no issues. */
export const STATEMENT_RULE_KEYWORDS = new Set(["mode", "balance", "bind", "server"]);
