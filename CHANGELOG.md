# Changelog

All notable user-facing changes to **HAProxy Language Support**.

## 0.8.1

- Refreshed keyword data and grammars for all supported versions (2.6–3.4).
- Warnings for deprecated sample fetches and converters in ACL criteria and inline expressions (e.g. `hdr_cnt()`).
- Hover documentation for sample fetches inside ACL criteria and `{ }` expressions; prefers fetch docs over bare ACL criterion entries.
- Improved argument validation for optional keyword/value groups — `log` with `ring@`, `len`, and `format`; fewer false positives on multi-signature directives like `bind`.
- `bind` — validates each comma-separated address separately.
- `log-profile` section recognized; `tcp-request inspect-delay` no longer flagged as unknown.

## 0.8.0

- Refreshed keyword data for all supported versions (2.6–3.4): improved hover text, argument validation, and completion.
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
