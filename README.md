# HAProxy Language Support

**Schema-driven language support for HAProxy configuration files** in Visual Studio Code and compatible editors.

Open any `.cfg` file and get syntax highlighting, context-aware completion, inline documentation, schema-based diagnostics, **go to definition** and **find all references**, document formatting, and section outline — all tuned to the HAProxy release you run in production (**2.6**, **2.8**, **3.0**, **3.2**, or **3.4**).

---

## Features

### Syntax highlighting

Colorization is generated from HAProxy’s own keyword inventory (`haproxy -dKall`), not hand-maintained lists. Sections, directives, ACLs, sample expressions, and related constructs are scoped consistently across large configs.

![Syntax highlighting for sections, directives, and expressions](docs/images/syntax-highlight.png)

### Intelligent completion

Suggestions follow where you are in the file:

- **Global and section headers** (`global`, `defaults`, `frontend`, `backend`, `listen`, …)
- **Directives and keywords** valid for the current section
- **`option` / `default-server` values**, HTTP/TCP rule actions, ACL criteria
- **`bind` and `server` parameters**, stick-table keys, filter/trace arguments
- **Sample fetches and converters** inside expressions
- **Enum argument values** where the schema defines allowed choices (e.g. `mode tcp|http`)

Completion reloads immediately when you change the configured HAProxy version.

![Context-aware completion for section directives](docs/images/completion-directives.png)

### Inline documentation

Hover any supported keyword to read summaries sourced from HAProxy’s official `configuration.txt`. Many entries include a **link to the upstream HAProxy documentation** for the full reference. Conditional block directives (`.if`, `.elif`, `.else`, `.endif`) are documented as well.

![Hover documentation with signature and upstream doc link](docs/images/hover-documentation.png)

### Real-time diagnostics

Catch common mistakes while you type:

| Category    | Examples                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------- |
| Keywords    | Unknown directive, keyword used in the wrong section, **deprecated** keyword                  |
| Structure   | Nested `option` / parameter misuse; keywords marked `(!)` in anonymous `defaults`             |
| Arguments   | Missing or extra arguments for known statement shapes                                         |
| Expressions | Invalid sample fetch / converter references, ACL-only criteria misuse                         |
| Rules       | Unknown or **deprecated** `http-request` / `tcp-request` action, unknown `use-service` target |

Diagnostics are **schema-based** — they help you write valid-looking config faster, but they do **not** replace `haproxy -c` for a full syntax check. Always validate with your real binary before deploying.

![Wrong-section diagnostic with inline directive help](docs/images/diagnostics-wrong-section.png)

### Document formatting

Run **Format Document** (or enable format-on-save) to normalize layout according to HAProxy’s configuration file rules:

- Section headers (`global`, `frontend`, …) stay left-aligned; directives inside a section are indented consistently.
- Comments and quoted strings are preserved; inline `#` comments stay on the same line.
- Optional blank lines are inserted before each new section header.

Indent style (4 spaces, 2 spaces, or tab) and blank-line behavior are configurable — see **Settings** below.

### Outline and folding

Navigate large configs with built-in structure support:

- **Outline** — lists every top-level section (`frontend www`, `backend api`, …) so you can jump quickly.
- **Folding** — collapse a section’s body while keeping its header visible.

### Go to definition and find references

Jump across related config with standard editor navigation (**Go to Definition**, **Go to References**, peek view):

- **Frontends / backends / listen** — `use_backend`, `default_backend`, and section headers link to the matching proxy section
- **ACLs** — definitions and uses in `if` / `unless` conditions within the same section (including negated forms like `!is_api`)
- **Servers** — `server` lines and `use-server` references inside a backend or listen
- **Defaults profiles** — `defaults … from <profile>` links to the named profile
- **Filters, cache, userlist, resolvers, peers** — section and statement definitions indexed from the schema

![Find references for a backend used from a frontend](docs/images/febe-findreferences.png)

![Go to definition and references for ACL definitions and uses](docs/images/acl-findreferences.png)

---

## Getting started

1. **Install** the extension from the Marketplace (or load a `.vsix` locally).
2. **Open** a HAProxy config (`.cfg` extension is recognized automatically).
3. **Choose your HAProxy version** so completion, hover, diagnostics, formatting, and highlighting match your deployment (see below).

No extra runtime is required for day-to-day editing — schemas and grammars ship with the extension.

---

## HAProxy version

Pick the release that matches the binaries you operate:

| Version | Default? | Notes                                      |
| ------- | -------- | ------------------------------------------ |
| **3.2** | Yes      | Recommended for most users on the 3.x line |
| **3.4** |          | Latest supported 3.x line                  |
| **3.0** |          | 3.x LTS                                    |
| **2.8** |          | Latest supported 2.x line                  |
| **2.6** |          | 2.x LTS                                    |

Schemas for **2.6** and **2.8** are generated from the legacy `configuration.txt` layout (actions listed under each ruleset in §4.2 rather than §4.3/§4.4). Completion, diagnostics, and hover reflect keywords available in that release.

**Ways to change version:**

- **Status bar** — click **HAProxy** while a `.cfg` file is active.
- **Command Palette** — run **HAProxy: Select HAProxy Version**.
- **Settings** — set **HAProxy: Version** (`haproxy.version`).

Completion, diagnostics, and hover update as soon as the setting changes. Syntax highlighting switches the active TextMate grammar; if colors do not refresh, use **Developer: Reload Window** when prompted.

![Quick-pick to select the HAProxy release](docs/images/version-select.png)

---

## Settings

| Setting                                         | Default    | Description                                                                                                                                                    |
| ----------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `haproxy.version`                               | `3.2`      | HAProxy release used for completion, diagnostics, hover, and syntax highlighting                                                                               |
| `haproxy.diagnostics.enabled`                   | `true`     | Turn off if opening very large `.cfg` files feels slow                                                                                                         |
| `haproxy.diagnostics.debounceMs`                | `500`      | Delay after edits before recomputing diagnostics (100–5000 ms)                                                                                                 |
| `haproxy.diagnostics.maxLines`                  | `4000`     | Skip diagnostics above this line count to limit memory use                                                                                                     |
| `haproxy.diagnostics.deprecatedWarnings`        | `true`     | Warn on directives and rule actions marked `(deprecated)` in the official docs. Warnings are suppressed when `global` contains `expose-deprecated-directives`. |
| `haproxy.format.enabled`                        | `true`     | Enable **Format Document** for HAProxy configs                                                                                                                 |
| `haproxy.format.indent`                         | `spaces-4` | Indentation inside sections: `spaces-4`, `spaces-2`, or `tab`                                                                                                  |
| `haproxy.format.insertBlankLineBetweenSections` | `true`     | Insert a blank line before each new section header when formatting                                                                                             |

The extension also raises `editor.maxTokenizationLineLength` for HAProxy files so long `server` / `bind` lines tokenize correctly.

![Extension settings in the VS Code Settings UI](docs/images/settings.png)

---

## Commands

| Command                             | Description                                    |
| ----------------------------------- | ---------------------------------------------- |
| **HAProxy: Select HAProxy Version** | Quick-pick between 2.6, 2.8, 3.0, 3.2, and 3.4 |

---

## How it works

Language data is built offline from two upstream sources:

1. **`configuration.txt`** — descriptions and documentation structure per HAProxy release.
2. **`haproxy -dKall`** — the complete keyword list emitted by the binary.

Those inputs are merged into JSON schemas, completion/hover payloads, and TextMate grammars (see the companion [**haproxy-schema**](https://github.com/Exymat/haproxy-schema) repository). The VS Code extension loads the bundled artifacts for the version you select — no Python or local HAProxy install needed to **use** the extension.

---

## Report issues

Found a false positive, missing completion, or wrong hover text? Open an issue on [GitHub](https://github.com/Exymat/haproxy-vscode/issues).

**Required information** — issues without these details are hard to reproduce and may be closed:

1. **Offending config** — paste the exact line(s) or a minimal snippet that triggers the problem (redact secrets; keep structure intact).
2. **Error or unexpected behavior** — copy the full diagnostic message from the Problems panel, or describe what you expected vs. what happened (e.g. no squiggle, wrong completion list).

**Helpful context** (include when relevant):

- **HAProxy: Version** (`haproxy.version`) — e.g. `3.2`
- Extension version and editor (VS Code version)
- Whether `haproxy -c` accepts or rejects the same config on your binary

---

## Contributing

The extension repo is **self-contained for CI**: unit and integration tests use bundled schemas under `schemas/` and config snippets under `test/fixtures/`. No sibling checkout is required to run `npm test` or `npm run test:coverage`.

Schema generation and upstream config corpus validation live in the companion [**haproxy-schema**](https://github.com/Exymat/haproxy-schema) repository. Optional monorepo checkouts are only for regeneration and extended local validation:

```
parent/
  haproxy-vscode/     # this extension (CI runs here)
  haproxy-schema/     # schema & grammar generator (python -m haproxy_schema)
  haproxy_git/        # optional: upstream HAProxy trees for regeneration & test:upstream
    haproxy-2.6/
    haproxy-2.8/
    haproxy-3.0/
    haproxy-3.2/
    haproxy-3.4/
```

### Extension

From `haproxy-vscode/`:

```powershell
npm install
npm run compile
```

`compile` also refreshes `syntaxes/haproxy-active.tmLanguage.json` (gitignored; copied from the default grammar `haproxy-3.2.tmLanguage.json`).

Use **Run HAProxy Extension** in the Run and Debug view after compiling.

Lint and format (enforced in CI):

```powershell
npm run lint
npm run format:check
npm run format    # auto-fix formatting
```

```powershell
npm test
```

Runs Vitest unit tests and VS Code Extension Development Host integration tests. Tests load bundled schemas and fixtures from `test/fixtures/` (including curated upstream snippets in `test/fixtures/golden/`). For coverage only:

```powershell
npm run test:coverage
```

For extended local validation (grammar check, full upstream scans, `haproxy -c` comparison) when sibling repos are present:

```powershell
npm run test:all
```

Optional upstream-only scripts (require sibling `haproxy_git/`):

```powershell
npm run test:upstream
npm run compare:haproxy
```

To run schema pytest plus extension tests from a monorepo layout:

```powershell
.\haproxy-schema\scripts\test-all.ps1
```

### Regenerating schemas

Set `PYTHONPATH` to the **haproxy-schema** repo root, then from `haproxy-vscode/`:

```powershell
$env:PYTHONPATH = (Resolve-Path "..\haproxy-schema").Path
npm run generate:schema:3.2
npm run compile
```

Replace `3.2` with any supported version (`2.6`, `2.8`, `3.0`, `3.4`, …) as needed. After regenerating a non-default grammar, run `npm run sync:active-grammar -- <version>` if you want local highlight tests to use that version. To refresh keyword dumps (requires a DEBUG build of the matching HAProxy binary in `haproxy_git/`):

```powershell
npm run generate:dkall:2.6
npm run generate:dkall:2.8
npm run generate:dkall:3.2
```

See [**haproxy-schema** README](https://github.com/Exymat/haproxy-schema) for `dkall` generation, binary installation, pytest, and upstream golden-config validation.

### Packaging

```powershell
npm run package
```

Produces a `.vsix` via `@vscode/vsce` (`vscode:prepublish` compiles TypeScript automatically).

---

## License

[MIT](LICENSE)
