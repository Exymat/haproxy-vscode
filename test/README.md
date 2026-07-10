# Test Layout

The fast unit suite runs with Vitest through `npm run test:unit` and includes
`test/unit/**/*.test.ts`. Keep tests in the folder that owns the behavior:

- `diagnostics/`: diagnostic pipeline, suppression, section, argument, reference, and unused-symbol checks.
- `completion/`: completion dispatch, handlers, docs, and symbol-reference completions.
- `hover/`: hover dispatch, handlers, formatting, and hover-specific helpers.
- `symbolIndex/` and `workspaceSymbolIndex/`: in-document and workspace symbol graph behavior.
- `extension/`: activation, providers, settings, status bar, version selection, output, and mocked VS Code lifecycle behavior.
- `syntax/`: grammar, TextMate highlighting, line isolation, and fixture smoke tests.
- `formatting/`, `navigation/`, `schema/`, `parser/`, and `core/`: focused subsystem tests that do not fit the categories above.

Use `test/helpers` for shared test building blocks. Keep domain-only helpers next
to their tests. Tests that need the VS Code API mock should import from
`test/helpers/vscode` rather than importing `test/__mocks__/vscode` directly.

Avoid catch-all coverage files. If a branch needs a regression test, place it in
the owning subsystem and name the behavior being protected. Fixture-wide checks
should be explicit smoke or contract tests, not substitutes for focused unit
coverage.
