const { defineConfig } = require("@vscode/test-cli");

const FIXTURES_ENV = "HAPROXY_INTEGRATION_FIXTURES_DIR";
const FOLDER_SCOPED_WORKSPACE_ENV = "HAPROXY_INTEGRATION_FOLDER_SCOPED_WORKSPACE";

const mochaBase = {
  timeout: 30000,
  require: ["./out/test/integration/suite/preload.js"],
};

const folderScopedWorkspace = process.env[FOLDER_SCOPED_WORKSPACE_ENV];

/** @type {import('@vscode/test-cli').TestConfiguration[]} */
const configs = [
  {
    label: "integration",
    files: "out/test/integration/**/*.test.js",
    workspaceFolder: process.env[FIXTURES_ENV] || "./test/integration/fixtures",
    launchArgs: ["--disable-extensions"],
    mocha: {
      ...mochaBase,
      ...(folderScopedWorkspace ? { grep: "Folder-scoped HAProxy version", invert: true } : {}),
    },
  },
];

if (folderScopedWorkspace) {
  configs.push({
    label: "folder-scoped",
    files: "out/test/integration/suite/08-folder-scoped-version.test.js",
    workspaceFolder: folderScopedWorkspace,
    launchArgs: ["--disable-extensions"],
    mocha: mochaBase,
  });
}

module.exports = defineConfig(configs);
