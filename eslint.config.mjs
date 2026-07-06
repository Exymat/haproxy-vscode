// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";

const srcFiles = ["src/**/*.ts"];
const testFiles = ["test/**/*.ts", "vitest.config.ts"];

/** @type {import("eslint").Linter.RulesRecord} */
const testRuleOverrides = {
  "vitest/no-mocks-import": "off",
  // Helpers such as runCase and runDiagnosticCase wrap assertions in nested callbacks.
  "vitest/expect-expect": "off",
};

export default defineConfig(
  {
    ignores: [
      "out/**",
      "coverage/**",
      "node_modules/**",
      "schemas/**",
      "syntaxes/**",
      ".vscode-test/**",
      "*.vsix",
    ],
  },
  {
    files: [...srcFiles, ...testFiles],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      eslintConfigPrettier,
    ],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: srcFiles,
  },
  {
    files: testFiles,
    plugins: { vitest },
    rules: {
      .../** @type {import("eslint").Linter.RulesRecord} */ (vitest.configs.recommended.rules),
      ...testRuleOverrides,
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...vitest.environments.env.globals,
        ...globals.mocha,
      },
    },
  },
  {
    files: ["test/integration/**/*.ts"],
    rules: {
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: [
            "expect",
            "assert",
            "assertDiagnosticCounts",
            "assertDiagnosticMinimumCounts",
          ],
          additionalTestBlockFunctions: ["test"],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    extends: [js.configs.recommended, eslintConfigPrettier],
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
