# HAProxy VS Code MVP

HAProxy `.cfg` support for **3.0** and **3.2**: schema-driven diagnostics, completion, hover, and generated TextMate grammar.

Schema generation and full integration tests expect a sibling **haproxy-schema** repo (clone both repositories into the same parent directory). Optional: clone [HAProxy](https://github.com/haproxy/haproxy) as `haproxy_git/haproxy-<version>` for regeneration and `npm test` against upstream configs.



## HAProxy version



Set the release in VS Code settings (**HAProxy: Version**, `haproxy.version`):



- **3.2** (default) — `schemas/haproxy-3.2.*`, `syntaxes/haproxy-3.2.tmLanguage.json`

- **3.0** — `schemas/haproxy-3.0.*`, `syntaxes/haproxy-3.0.tmLanguage.json`



Completion, diagnostics, and hover reload immediately when you change the setting. Syntax highlighting uses `syntaxes/haproxy-active.tmLanguage.json`; the extension updates that file on activation and when the version changes, then offers **Reload Window** so TextMate picks up the new grammar.



## Features



- Syntax highlighting from generated grammars (`haproxy-3.0` / `haproxy-3.2`)

- Autocomplete for sections, directives, `option` values, rule actions, ACL criteria, bind/server parameters, sample fetches/converters

- Hover documentation from `configuration.txt` (via schema build)

- Diagnostics: unknown keywords, section mismatches, nested options/parameters, argument arity, sample expressions



## Rebuild schema (Windows + WSL)



Keyword lists come from `haproxy -dKall` (requires a DEBUG build; Debian/Ubuntu packages usually work). Checked-in dumps live in `haproxy-schema/haproxy_schema/dkall-3.2.txt` and `dkall-3.0.txt`. Regenerate from WSL:

```powershell
# From repo root (uses WSL haproxy by default)
.\haproxy-schema\scripts\generate-dkall.ps1 -Version 3.2
.\haproxy-schema\scripts\generate-dkall.ps1 -Version 3.0

# Or from haproxy-vscode/
npm run generate:dkall:3.2
```

The dump uses `haproxy -dKall -q -c -f` on `haproxy_git/haproxy-<ver>/tests/conf/basic-check.cfg` when present, otherwise `/dev/null` (non-zero exit is normal). If `-dKall` prints only usage text, the binary lacks DEBUG.



**HAProxy 3.2:**



```powershell
# From a parent directory that contains both haproxy-vscode/ and haproxy-schema/ clones:
$env:PYTHONPATH = (Resolve-Path ".\haproxy-schema").Path
npm run generate:schema:3.2 --prefix haproxy-vscode
npm run sync:active-grammar --prefix haproxy-vscode -- 3.2
```



**HAProxy 3.0** (regenerate `dkall-3.0.txt` when you have a 3.0 `haproxy` binary; otherwise the checked-in file may come from a newer package):



```powershell

npm run generate:schema:3.0 --prefix haproxy-vscode

npm run sync:active-grammar --prefix haproxy-vscode -- 3.0

```



From `haproxy-vscode/`:



```powershell

$env:PYTHONPATH="..\haproxy-schema"

npm run compile

```



## Tests



```powershell
# Schema tests (from parent directory with haproxy-schema/ clone):
$env:PYTHONPATH = (Resolve-Path ".\haproxy-schema").Path
python -m pytest tools\haproxy_schema\tests

cd haproxy-vscode
npm test
```

`npm test` includes `compare:haproxy`, which runs `haproxy -c` on every file under `haproxy_git/haproxy-3.2/tests/conf` and checks alignment with extension error lines (via WSL on Windows).

Or run both: `haproxy-schema\scripts\test-all.ps1`



## Outputs



| File | Purpose |

|------|---------|

| `schemas/haproxy-{3.0,3.2}.schema.json` | Sections, keywords, `statement_rules`, sample fetches/converters |

| `schemas/haproxy-{3.0,3.2}.language.json` | Completion/hover payloads |

| `syntaxes/haproxy-{3.0,3.2}.tmLanguage.json` | Generated TextMate grammars |

| `syntaxes/haproxy-active.tmLanguage.json` | Grammar path referenced by `package.json` (synced from selected version) |

| `haproxy-schema/haproxy_schema/coverage-3.2.json` | Doc vs dkall gap report (3.2 build) |

