import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/bench/**/*.bench.ts"],
    // Vitest 5 bench projects clamp timeouts below 60s up to 60s, so `0` becomes
    // 60s and fails large tokenize runs (~90–120s on CI).
    testTimeout: 300_000,
    hookTimeout: 120_000,
    benchmark: {
      include: ["test/bench/**/*.bench.ts"],
    },
  },
  resolve: {
    alias: {
      vscode: path.resolve(import.meta.dirname, "test/__mocks__/vscode.ts"),
    },
  },
});
