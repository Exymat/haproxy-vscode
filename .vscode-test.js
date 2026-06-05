const { defineConfig } = require("@vscode/test-cli");

module.exports = defineConfig({
  files: "out/test/integration/**/*.test.js",
  workspaceFolder: "./test/integration/fixtures",
  launchArgs: ["--disable-extensions"],
  mocha: {
    timeout: 30000,
  },
});
