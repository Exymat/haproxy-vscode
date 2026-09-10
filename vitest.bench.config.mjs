import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/bench/**/*.bench.ts"],
    // Benchmarks are not unit tests; disable the default 5s timeout.
    testTimeout: 0,
    hookTimeout: 60_000,
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
