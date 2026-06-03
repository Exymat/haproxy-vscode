# HAProxy Config

**Schema-driven language support for HAProxy configuration files** in Visual Studio Code and compatible editors.

Open any `.cfg` file and get syntax highlighting, context-aware completion, inline documentation, and diagnostics tuned to the HAProxy release you run in production — **3.0**, **3.2**, or **3.4**.

---

## Features

### Syntax highlighting

Colorization is generated from HAProxy’s own keyword inventory (`haproxy -dKall`), not hand-maintained lists. Sections, directives, ACLs, sample expressions, and related constructs are scoped consistently across large configs.

### Intelligent completion

Suggestions follow where you are in the file:

- **Global and section headers** (`global`, `defaults`, `frontend`, `backend`, `listen`, …)
- **Directives and keywords** valid for the current section
- **`option` / `default-server` values**, HTTP/TCP rule actions, ACL criteria
- **`bind` and `server` parameters**, stick-table keys, filter/trace arguments
- **Sample fetches and converters** inside expressions

Completion reloads immediately when you change the configured HAProxy version.

### Inline documentation

Hover any supported keyword to read summaries sourced from HAProxy’s official `configuration.txt`, with links to the upstream documentation where available.

### Real-time diagnostics

Catch common mistakes while you type:

| Category | Examples |
| -------- | -------- |
| Keywords | Unknown directive, keyword used in the wrong section |
| Structure | Nested `option` / parameter misuse |
| Arguments | Missing or extra arguments for known statement shapes |
| Expressions | Invalid sample fetch / converter references |

Diagnostics are **schema-based** — they help you write valid-looking config faster, but they do **not** replace `haproxy -c` for a full syntax check. Always validate with your real binary before deploying.

---

## Getting started

1. **Install** the extension from the Marketplace (or load a `.vsix` locally).
2. **Open** a HAProxy config (`.cfg` extension is recognized automatically).
3. **Choose your HAProxy version** so completion, hover, diagnostics, and highlighting match your deployment (see below).

No extra runtime is required for day-to-day editing — schemas and grammars ship with the extension.

---

## HAProxy version

Pick the release that matches the binaries you operate:

| Version | Default? | Notes |
| ------- | -------- | ----- |
| **3.2** | Yes | Recommended for most users |
| **3.4** | | Latest supported line |
| **3.0** | | Legacy LTS |

**Ways to change version:**

- **Status bar** — click **HAProxy** while a `.cfg` file is active.
- **Command Palette** — run **HAProxy: Select HAProxy Version**.
- **Settings** — set **HAProxy: Version** (`haproxy.version`).

Completion, diagnostics, and hover update as soon as the setting changes. Syntax highlighting switches the active TextMate grammar; if colors do not refresh, use **Developer: Reload Window** when prompted.

---

## Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `haproxy.version` | `3.2` | HAProxy release used for completion, diagnostics, hover, and syntax highlighting |
| `haproxy.diagnostics.enabled` | `true` | Turn off if opening very large `.cfg` files feels slow |
| `haproxy.diagnostics.debounceMs` | `500` | Delay after edits before recomputing diagnostics (100–5000 ms) |
| `haproxy.diagnostics.maxLines` | `4000` | Skip diagnostics above this line count to limit memory use |

The extension also raises `editor.maxTokenizationLineLength` for HAProxy files so long `server` / `bind` lines tokenize correctly.

---

## Commands

| Command | Description |
| ------- | ----------- |
| **HAProxy: Select HAProxy Version** | Quick-pick between 3.0, 3.2, and 3.4 |

---

## How it works

Language data is built offline from two upstream sources:

1. **`configuration.txt`** — descriptions and documentation structure per HAProxy release.
2. **`haproxy -dKall`** — the complete keyword list emitted by the binary.

Those inputs are merged into JSON schemas, completion/hover payloads, and TextMate grammars (see the companion [**haproxy-schema**](https://github.com/Exymat/haproxy-schema) repository). The VS Code extension loads the bundled artifacts for the version you select — no Python or local HAProxy install needed to **use** the extension.

---

## Contributing

Development involves two repositories:

```
parent/
  haproxy-vscode/     # this extension
  haproxy-schema/     # schema & grammar generator (python -m haproxy_schema)
  haproxy_git/        # optional: upstream HAProxy trees for regeneration & tests
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

Use **Run HAProxy Extension** in the Run and Debug view after compiling.

```powershell
npm test
```

Runs grammar, highlight, and diagnostic fixture tests, plus (when `haproxy_git` is present) comparison against `haproxy -c` on upstream sample configs.

### Regenerating schemas

Set `PYTHONPATH` to the **haproxy-schema** repo root, then from `haproxy-vscode/`:

```powershell
$env:PYTHONPATH = (Resolve-Path "..\haproxy-schema").Path
npm run generate:schema:3.2
npm run sync:active-grammar -- 3.2
```

Replace `3.2` with `3.0` or `3.4` as needed. To refresh keyword dumps:

```powershell
npm run generate:dkall:3.2
```

See [**haproxy-schema** README](https://github.com/Exymat/haproxy-schema) for `dkall` generation, binary installation, and pytest details. Run both test suites from a parent directory with:

```powershell
.\haproxy-schema\scripts\test-all.ps1
```

### Packaging

```powershell
npm run package
```

Produces a `.vsix` via `@vscode/vsce` (`vscode:prepublish` compiles TypeScript automatically).

---

## License

[MIT](LICENSE)
