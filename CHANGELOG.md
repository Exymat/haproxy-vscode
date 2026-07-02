# Changelog

All notable user-facing changes to **HAProxy Language Support**.

## 0.12.11

- Unused symbol hints are enabled by default and fade entire ACL/server lines (not just the symbol name).
- Removed the separate `haproxy.diagnostics.unusedSymbols.sections` setting; section blocks are included whenever unused symbol hints are on.
- Hover on sample fetches such as `req.hdr` in rule actions (e.g. `http-request set-var(...) req.hdr(host)`) shows fetch docs instead of the parent directive.

## 0.12.10

- Format Document collapses multiple blank lines between sections to one, removes trailing blank lines at end of file, and keeps blank lines within a section.

## 0.12.9

- Section header completion while typing — partial names like `fron` or `back` suggest `frontend` and `backend`.
- Section headers are offered on new top-level lines (empty files and between sections), but not on indented blank lines inside a section or on section name tokens.
- Section completion list follows the full schema section header set for the active HAProxy version.

## 0.12.8

- Server `usesrc` option — validation and hover for `client`/`clientip`, `hdr_ip(...)`, and address forms; schema metadata added across supported versions.
- Fixed `source` argument validation on server lines when followed by `usesrc`.
- Fewer false bracket/quote warnings inside ACL conditions (`{...}`) and `%[...]` sample expressions.
- Refreshed schemas (2.6–3.4) with corrected `source` address slots and `usesrc` line-option semantics.

## 0.12.7

- Faster Go to Definition and Find References on large configs — symbol index is reused when a single-line edit does not change symbol names.
- Format Document, folding, and the document outline use schema section headers for the active HAProxy version.
- Shared per-line semantic context improves directive-argument completion and hover consistency.

## 0.12.6

- Section parsing follows schema-defined section headers, staying aligned with each supported HAProxy version.
- Clearer error when schema or language data fails to load (corrupt or incomplete bundle files).
- Switching HAProxy version fully refreshes cached language data, indexes, and section configuration.

## 0.12.5

- Fixed `userlist user` validation — `password` and `insecure-password` are recognized as separate option keywords (e.g. `user alice insecure-password … groups admins`).
- Refreshed schemas (2.6–3.4) with corrected pipe-separated enum values in argument models.

## 0.12.4

- Rule-action hover resolves parenthesized names (e.g. `set-var-fmt(txn.foo)`) and prefers the current ruleset's action list.
- Improved `bind`/`server` line-option validation and hover — correct manual chapters (5.1/5.2), optional keyword/value groups, and missing-argument checks for value-taking options.
- Fixed argument validation for `log` optional groups, `stick-table type` store arguments, and similar variadic trailing slots.
- Refreshed schemas and 3.4 grammar for corrected line-option semantics and `tune.h2.fe.max-concurrent-streams` highlighting.

## 0.12.3

- Argument validation stops at `if`/`unless` — condition tokens are no longer counted as missing or extra directive arguments.
- Fewer false wrong-context warnings on `bind`/`server` options when the schema has no mode context for that option group.
- Faster diagnostics — delimiter checks skip lines without brackets or quotes; nested-keyword validation runs only on relevant statement types.

## 0.12.2

- Refreshed keyword data for all supported versions (2.6–3.4) — bind/server line options now carry schema metadata for parent context, manual chapter, and value-taking behavior.
- Improved bind/server validation — enum slot values are no longer misread as nested options when scanning option arguments.
- Go to Definition and Find References for resolvers, peers, cache, and `filter-sequence` lists are driven by schema reference patterns instead of hardcoded heuristics.
- Statement layout and symbol indexing use schema `match_tokens` rules; legacy http/tcp action and phase fallbacks removed.

## 0.12.1

- Go to Definition and Find References now reuse the scope index built during symbol indexing instead of rescanning lines on each request.

## 0.12.0

- Completion, hover, and diagnostics now share unified line analysis — bind/server option spans, rule actions, and statement layout are interpreted consistently across all language features.
- Faster completion, hover, and diagnostics on large configs from precomputed keyword indexes, schema lookup caches, and a shared section-outline pass reused by outline, folding, and unused-symbol hints.
- Faster Go to Definition and Find References — symbol scope is recorded during indexing instead of backward line scans.
- More reliable diagnostic updates when editing, switching HAProxy versions, or closing documents.

## 0.11.4

- Faster edits on large configs — incremental parsing and per-line diagnostic caching reuse unchanged lines instead of reprocessing the whole file on every keystroke.
- Mode-aware diagnostics cache section runtime modes across edits when mode/section headers are untouched.

## 0.11.3

- Outline, folding, and unused-section hints use precise section end positions instead of spanning the full line width.

## 0.11.2

- Faster diagnostics on large configs — cached keyword lookups, reused per-line statement rules, and indexed symbol references cut full-pass time roughly in half on stress fixtures; unused-symbol hints benefit from the same work.

## 0.11.1

- Log-format flag hover fixed for `+Q`, `-E`, and consecutive modifiers (`%{+Q+E}`) without comma separators; works on `log-format-sd` lines.
- `-m` and `-M` ACL flags no longer share hover text — case-sensitive matching in ACL definitions and inline `{ … }` conditions.
- Sample-fetch hover no longer triggers on `-`-prefixed tokens inside expressions.

## 0.11.0

- **Log-format support** — completion, hover, and diagnostics for `log-format`, `error-log-format`, `unique-id-format`, `set-var-fmt`, and embedded format strings (aliases, `{+flags}`, unknown alias/flag checks).
- **Unused symbol hints** (opt-in via `haproxy.diagnostics.unusedSymbols`) — fade ACLs, servers, and unreferenced section blocks; configurable with `haproxy.diagnostics.unusedSymbols.sections`.
- **Go to Definition / Find References** extended to cache, resolvers, peers, userlist, filters, and ACL names inside inline `{ … }` conditions.
- Hover and completion show **Examples** from the manual where available.
- Hover for sample fetches and ACL match methods inside inline `{ … }` conditions.
- Refreshed keyword data for all supported versions (2.6-3.4).

## 0.10.4

- **Line-isolated syntax highlighting** — `%[…]`, `{…}`, `(...)`, `[…]`, and quoted strings no longer leak grammar state to following lines when a delimiter is missing on the same line. Fixes broken highlighting on the rest of a file after a malformed sample expression or ACL block.
- **Delimiter diagnostics** — reports missing or unexpected `()`, `[]`, `{}`, and quotes on each line (e.g. `missing closing ']'` on `%[req.hdr(host)`), with squiggles on the opening delimiter.
- Regenerated TextMate grammars for all supported versions (2.6–3.4) from `haproxy-schema`, including the line-isolation end-of-line recovery rules.

## 0.10.3

- No user-facing changes.

## 0.10.2

- ACL flag hover (`-f`, `-i`, `-m`, `-n`, `-u`, `-M`) — case-sensitive matching; `-m` and `-M` no longer share the same documentation.
- `-M` ACL flag added to schemas for all supported versions.
- Sample fetches inside inline ACL conditions (e.g. `{ req.hdr(Host) -m found }`) are syntax-highlighted correctly.

## 0.10.1

- Richer hover for `http-request`, `http-response`, and `tcp-request` actions — fills in previously missing or truncated manual text (e.g. `set-path`, `track-sc1`, `deny`, `sc-inc-gpc1`, `set-var-fmt`, `wait-for-body`).
- `balance` hover documents all load-balancing algorithms and their options (roundrobin, leastconn, hash, uri, url_param, random, etc.).
- `http-request normalize-uri` sub-variants (`fragment-strip`, `path-strip-dotdot`, etc.) recognized in diagnostics, hover, and syntax highlighting.
- `track-sc1`/`track-sc2` and `expect-netscaler-cip` rule actions added to schema validation and syntax highlighting.
- Refreshed keyword data for all supported versions (2.6–3.4) — restores truncated descriptions for directives such as `compression`, `accepted_payload_size`, and `bind`.

## 0.10.0

- Context-aware completion on `bind` and `server` lines — suggests line options after the address (including comma-separated bind lists) and sub-option values (e.g. `interface`, `usesrc` after `source`).
- `bind`/`server` diagnostics and hover start after all leading addresses on multi-address `bind` lines.
- Hover and completion for section-specific `bind` variants in `peers` and `log-forward` sections.
- `healthcheck` recognized as its own section; healthcheck directives no longer treated as belonging to `program`.
- `bind` supports Unix socket path forms (`bind /<path>`) in schemas and documentation.
- Updated keyword data for 3.4 (healthcheck section, bind signatures).

## 0.9.0

- Richer hover for `bind` and `server` line options — all documented forms, nested sub-options (e.g. `interface` under `source`), and ASCII tables rendered as readable markdown tables.
- Hover for directive arguments shows alias forms (e.g. `random` / `random(<draws>)`) and keyworded parameters extracted from the manual (e.g. `meth` on `http-check send`).
- Validation for nested `bind`/`server`/`default-server` options — understands sub-option arguments and reports missing values (e.g. `source … interface` without an interface name).
- `balance` accepts parenthesized algorithm forms such as `random(5)` and `url_param`.
- Refreshed keyword data and grammars for all supported versions (2.6-3.4).

## 0.8.4

- **Go to Definition** and **Find All References** for ACL names in compound `if`/`unless` conditions — supports `&&`, `||`, and negation (`!acl_name`).

## 0.8.3

- Section-aware documentation for keywords that differ by context (`bind`, `log`, `server`, `description`, and many others) — hover, completion, and argument checks now match the current section instead of merging every manual chapter into one entry.
- Hover shows the section-specific signature and doc link (e.g. `bind` in a frontend vs. peers vs. log-forward section).
- Refreshed keyword data and grammars for all supported versions (2.6-3.4).
- Fewer false missing-argument warnings on directives with multiple optional signatures.

## 0.8.2

- Faster diagnostics and completion on large configs — per-line directive lookups are memoized and schema-derived keyword sets are cached.
- Section outline and folding built in a single pass for quicker updates on configs with many sections.
- Clear error notification when schema or language data fails to load, instead of silently disabling features.
- Pending diagnostics cancelled when a document is closed or the extension deactivates.
- `#` comments highlighted only at the start of a line — inline `#` in values (URLs, headers, etc.) is no longer mis-styled as a comment.

## 0.8.1

- Refreshed keyword data and grammars for all supported versions (2.6-3.4).
- Warnings for deprecated sample fetches and converters in ACL criteria and inline expressions (e.g. `hdr_cnt()`).
- Hover documentation for sample fetches inside ACL criteria and `{ }` expressions; prefers fetch docs over bare ACL criterion entries.
- Improved argument validation for optional keyword/value groups — `log` with `ring@`, `len`, and `format`; fewer false positives on multi-signature directives like `bind`.
- `bind` — validates each comma-separated address separately.
- `log-profile` section recognized; `tcp-request inspect-delay` no longer flagged as unknown.

## 0.8.0

- Refreshed keyword data for all supported versions (2.6-3.4): improved hover text, argument validation, and completion.
- `balance url_param` — variant-specific argument checks and enum suggestions (no longer mixed with other balance algorithms).
- `http-send-name-header` — flags `host` as an invalid value (3.4+).

## 0.7.3

- No user-facing changes.

## 0.7.2

- Faster startup: schema and grammar load asynchronously instead of blocking activation.
- Broader bind and server parameter coverage in completion, diagnostics, and highlighting.

## 0.7.1

- Mode-aware diagnostics flag directives and options used in the wrong tcp/http context.
- Hover shows valid modes for mode-scoped keywords and options.
- Validation for modifier-prefixed directives (`no-`, etc.) and conditional tokens.
- Improved argument checks (missing/extra arguments, options-with-value shapes).

## 0.6.1

- **Go to Definition** and **Find All References** for backends, ACLs, servers, defaults profiles, filters, and related symbols.
- **Format Document** with configurable indentation and optional blank lines between sections.
- Section outline and code folding.
- HAProxy **2.6** and **2.8** support.
- Warnings for deprecated directives and rule actions (configurable; respects `expose-deprecated-directives`).
- Improved context-aware completion and enum value suggestions.

## 0.5.0

- Support for `.if` / `.elif` / `.else` / `.endif` conditional blocks in hover and diagnostics.
- Hover links to the official HAProxy documentation.
- Diagnostics for ACL-only criteria misused in expressions and unknown `use-service` targets.
- MPTCP address prefix validation.
- Refreshed keyword data for 3.0, 3.2, and 3.4.

## 0.4.2

- HAProxy **3.4** support.
- Status bar version picker and **HAProxy: Select HAProxy Version** command.
- Settings to enable/disable diagnostics, adjust debounce delay, and skip very large files.
- Improved argument and expression diagnostics; better tokenization of long lines.
- Renamed extension to **HAProxy Language Support**.

## 0.4.0

- Initial release: syntax highlighting, context-aware completion, hover documentation, and schema-based diagnostics for HAProxy **3.0** and **3.2**.
