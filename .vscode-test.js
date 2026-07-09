const { defineConfig } = require("@vscode/test-cli");

const FIXTURES_ENV = "HAPROXY_INTEGRATION_FIXTURES_DIR";
const WORKSPACE_ENV = "HAPROXY_INTEGRATION_WORKSPACE";
const FOLDER_SCOPED_WORKSPACE_ENV = "HAPROXY_INTEGRATION_FOLDER_SCOPED_WORKSPACE";
const USER_DATA_DIR_ENV = "HAPROXY_INTEGRATION_USER_DATA_DIR";

const mochaBase = {
  timeout: 30000,
  require: ["./out/test/integration/suite/preload.js"],
};

const folderScopedWorkspace = process.env[FOLDER_SCOPED_WORKSPACE_ENV];
const integrationWorkspace =
  process.env[WORKSPACE_ENV] || folderScopedWorkspace || process.env[FIXTURES_ENV];
const launchArgs = [
  "--disable-extensions",
  ...(process.env[USER_DATA_DIR_ENV] ? [`--user-data-dir=${process.env[USER_DATA_DIR_ENV]}`] : []),
];

/** @type {import('@vscode/test-cli').TestConfiguration} */
const config = {
  label: "integration",
  files: "out/test/integration/**/*.test.js",
  workspaceFolder: integrationWorkspace || "./test/integration/fixtures",
  launchArgs,
  mocha: {
    ...mochaBase,
    ...(integrationWorkspace ? {} : { grep: "Folder-scoped HAProxy version", invert: true }),
  },
};

module.exports = defineConfig([
  {
    ...config,
  },
]);
