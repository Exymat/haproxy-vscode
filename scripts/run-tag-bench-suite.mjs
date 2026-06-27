#!/usr/bin/env node
import { runTests } from "@vscode/test-electron";

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const extensionDevelopmentPath = required("HAPROXY_TAG_BENCH_EXTENSION_PATH");
const extensionTestsPath = required("HAPROXY_TAG_BENCH_TESTS_PATH");
const workspaceFolder = required("HAPROXY_TAG_BENCH_WORKSPACE");

await runTests({
  extensionDevelopmentPath,
  extensionTestsPath,
  launchArgs: [workspaceFolder, "--disable-extensions"],
});
