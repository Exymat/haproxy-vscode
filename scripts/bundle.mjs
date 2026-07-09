#!/usr/bin/env node
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: [join(root, "src/extension.ts")],
  bundle: true,
  outfile: join(root, "out/extension.js"),
  platform: "node",
  format: "cjs",
  target: "es2024",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log("esbuild: watching extension bundle");
} else {
  await esbuild.build(buildOptions);
}
