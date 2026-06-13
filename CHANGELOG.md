# Changelog

All notable user-facing changes to **HAProxy Language Support**.

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
