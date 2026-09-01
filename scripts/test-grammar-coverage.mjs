#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "..");
const schemaRoot = resolve(extensionRoot, "..", "haproxy-schema");
const schemasDir = join(extensionRoot, "schemas");
const syntaxesDir = join(extensionRoot, "syntaxes");

const env = {
  ...process.env,
  PYTHONPATH: schemaRoot,
};

const artifacts = readdirSync(schemasDir)
  .map((name) => /^haproxy-(\d+\.\d+(?:r1)?)\.schema\.json$/.exec(name))
  .filter((match) => match !== null)
  .map((match) => match[1])
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

for (const artifact of artifacts) {
  const schemaPath = join(schemasDir, `haproxy-${artifact}.schema.json`);
  const grammarPath = join(syntaxesDir, `haproxy-${artifact}.tmLanguage.json`);
  if (!existsSync(grammarPath)) {
    process.stderr.write(`Missing grammar for schema haproxy-${artifact}.schema.json\n`);
    process.exit(1);
  }

  const result = spawnSync(
    "python",
    ["-m", "haproxy_schema", "check-grammar", "--schema", schemaPath, "--grammar", grammarPath],
    { cwd: extensionRoot, env, encoding: "utf-8" },
  );

  if (result.stdout) {
    process.stdout.write(`${artifact}: ${result.stdout}`);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Grammar coverage passed for ${artifacts.length} versioned artifacts`);
