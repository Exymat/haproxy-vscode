#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "..");
const schemaRoot = resolve(extensionRoot, "..", "haproxy-schema");
const schemaPath = join(extensionRoot, "schemas", "haproxy-3.2.schema.json");
const _templatePath = join(extensionRoot, "syntaxes", "haproxy.tmLanguage.json");

const env = {
  ...process.env,
  PYTHONPATH: schemaRoot,
};

const result = spawnSync(
  "python",
  ["-m", "haproxy_schema", "check-grammar", "--schema", schemaPath],
  { cwd: extensionRoot, env, encoding: "utf-8" },
);

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
process.exit(result.status ?? 1);
