#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "out");

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
