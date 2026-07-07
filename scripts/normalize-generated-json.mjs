#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** @type {string[]} */
const paths = [];

for (const name of readdirSync(join(root, "schemas"))) {
  if (name.endsWith(".json")) {
    paths.push(join(root, "schemas", name));
  }
}

for (const name of readdirSync(join(root, "syntaxes"))) {
  if (name.startsWith("haproxy") && name.endsWith(".tmLanguage.json")) {
    paths.push(join(root, "syntaxes", name));
  }
}

let changed = 0;
for (const path of paths) {
  const original = readFileSync(path, "utf8");
  const normalized = original.replace(/\r\n/g, "\n");
  if (normalized !== original) {
    writeFileSync(path, normalized, "utf8");
    changed++;
  }
}

console.log(`Normalized LF line endings in ${changed} generated JSON file(s)`);
