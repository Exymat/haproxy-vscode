// @ts-check
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";

const srcFiles = ["src/**/*.ts"];
const testFiles = ["test/**/*.ts", "vitest.config.ts"];

/** @type {import("eslint").Linter.RulesRecord} */
const testRelaxedRules = {
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-enum-comparison": "off",
  "@typescript-eslint/require-await": "off",
  "@typescript-eslint/no-base-to-string": "off",
  "@typescript-eslint/restrict-template-expressions": "off",
  "vitest/no-mocks-import": "off",
  "vitest/expect-expect": "off",
  "vitest/valid-expect": "off",
  "vitest/no-conditional-expect": "off",
};

export default tseslint.config(
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
      ...testRelaxedRules,
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
