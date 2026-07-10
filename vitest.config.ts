import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/unit/**/*.test.ts"],
    fileParallelism: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/symbolIndex.ts",
        "src/symbolIndex/index.ts",
        "src/hover/index.ts",
        "src/hover/types.ts",
        "src/symbolIndex/workspaceTypes.ts",
        "src/hover/handlers/optionHover.ts",
        "src/completion/types.ts",
        "**/optionHover.ts",
      ],
      reporter: ["text", "lcov", "html"],
      thresholds: {
        branches: 98,
        lines: 100,
        statements: 100,
        functions: 100,
      },
    },
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "test/__mocks__/vscode.ts"),
    },
    // Prefer .ts sources over stray tsc emit next to .ts files (see .gitignore).
    extensions: [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".json"],
  },
});
