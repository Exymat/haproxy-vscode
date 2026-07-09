const { defineConfig } = require("@vscode/test-cli");

module.exports = defineConfig({
  files: "out/test/integration/**/*.test.js",
  workspaceFolder: process.env.HAPROXY_INTEGRATION_FIXTURES_DIR || "./test/integration/fixtures",
  launchArgs: ["--disable-extensions"],
  mocha: {
    timeout: 30000,
    require: ["./out/test/integration/suite/preload.js"],
  },
});
