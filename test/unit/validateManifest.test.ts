import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectMissingScriptReferences,
  extractNpmRunScriptNames,
  findMissingScriptReferences,
} from "../../scripts/validate-manifest.mjs";

const repoRoot = join(__dirname, "../..");

describe("extractNpmRunScriptNames", () => {
  it("extracts script names from npm run invocations", () => {
    expect(
      extractNpmRunScriptNames(
        "npm run compile && npm run format:generated && npm run generate:schema:3.2",
      ),
    ).toEqual(["compile", "format:generated", "generate:schema:3.2"]);
  });

  it("ignores non-npm-run commands", () => {
    expect(
      extractNpmRunScriptNames("node scripts/foo.mjs && python -m haproxy_schema build"),
    ).toEqual([]);
  });
});

describe("findMissingScriptReferences", () => {
  const scripts = {
    compile: "tsc -p ./",
    "format:generated": "node scripts/normalize-generated-json.mjs",
  };

  it("reports missing script references with source context", () => {
    expect(
      findMissingScriptReferences(
        scripts,
        "package.json scripts.generate:schema:all",
        "npm run sync:active-grammar",
      ),
    ).toEqual(["package.json scripts.generate:schema:all: npm run sync:active-grammar"]);
  });

  it("returns nothing when all referenced scripts exist", () => {
    expect(
      findMissingScriptReferences(
        scripts,
        "package.json scripts.vscode:prepublish",
        "npm run compile && npm run format:generated",
      ),
    ).toEqual([]);
  });
});

describe("collectMissingScriptReferences", () => {
  it("detects missing references in package scripts", () => {
    const scripts = {
      compile: "tsc -p ./",
      "generate:schema:all": "npm run compile && npm run sync:active-grammar",
    };

    expect(collectMissingScriptReferences(scripts, { workflowsDir: null })).toContain(
      "package.json scripts.generate:schema:all: npm run sync:active-grammar",
    );
  });

  it("passes when every npm run reference resolves to a declared script", () => {
    const scripts = {
      compile: "tsc -p ./",
      "format:generated": "node scripts/normalize-generated-json.mjs",
      "generate:schema:all": "npm run compile && npm run format:generated",
    };

    expect(collectMissingScriptReferences(scripts, { workflowsDir: null })).toEqual([]);
  });
});

describe("validate-manifest.mjs", () => {
  it("passes for the current repository manifest and workflows", () => {
    const result = spawnSync("node", ["scripts/validate-manifest.mjs"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("package.json validation passed");
  });
});
