#!/usr/bin/env node
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionBuildOptions = {
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

/** @type {import('esbuild').BuildOptions} */
const toolingBuildOptions = {
  entryPoints: [join(root, "src/diagnostics/index.ts")],
  bundle: true,
  outfile: join(root, "out/tooling/diagnostics.js"),
  platform: "node",
  format: "cjs",
  target: "es2024",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

const buildOptions = [extensionBuildOptions, toolingBuildOptions];

if (watch) {
  const contexts = await Promise.all(buildOptions.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("esbuild: watching extension and tooling bundles");
} else {
  await Promise.all(buildOptions.map((options) => esbuild.build(options)));
}
