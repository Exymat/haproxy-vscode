#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "..");
const version = process.argv[2] ?? "3.2";
const src = join(extensionRoot, "syntaxes", `haproxy-${version}.tmLanguage.json`);
const dst = join(extensionRoot, "syntaxes", "haproxy-active.tmLanguage.json");

if (!existsSync(src)) {
  console.error(`Missing grammar: ${src}`);
  process.exit(1);
}
copyFileSync(src, dst);
console.log(`Synced ${readFileSync(dst, "utf-8").split("\n").length} lines from haproxy-${version} to haproxy-active.tmLanguage.json`);
