import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

import { computeDiagnostics } from "../../src/diagnostics";
import { createDocument } from "../helpers/document";
import { hasHaproxyGit } from "../helpers/haproxyGit";
import { loadSchemaBundle, SUPPORTED_VERSIONS, type SupportedVersion } from "../helpers/schema";

const haproxyGitRoot = join(__dirname, "..", "..", "..", "haproxy_git");

function collectCfgFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectCfgFiles(full));
    } else if (entry.endsWith(".cfg")) {
      files.push(full);
    }
  }
  return files.sort();
}

const describeGolden = hasHaproxyGit() ? describe : describe.skip;

describeGolden("golden config diagnostics", () => {
  for (const version of SUPPORTED_VERSIONS) {
    describe(`haproxy ${version}`, () => {
      const bundle = loadSchemaBundle(version);

      for (const subdir of ["tests/conf", "examples"] as const) {
        const root = join(haproxyGitRoot, `haproxy-${version}`, subdir);
        const files = collectCfgFiles(root);

        it.each(files)(`computes diagnostics for ${subdir}/%s`, (filePath) => {
          const content = readFileSync(filePath, "utf-8");
          const doc = createDocument(content, `file://${filePath.replace(/\\/g, "/")}`);
          computeDiagnostics(doc as never, bundle.schema, {
            languageData: bundle.languageData,
            deprecatedWarnings: true,
          });
        });
      }
    });
  }
});

describeGolden("targeted upstream fixtures", () => {
  const cases: Array<{ version: SupportedVersion; file: string }> = [
    { version: "3.2", file: "ports.cfg" },
    { version: "3.2", file: "test-sample-fetch-args.cfg" },
    { version: "3.2", file: "test-sample-fetch-conv.cfg" },
    { version: "3.2", file: "test-acl-args.cfg" },
    { version: "3.2", file: "test-valid-names.cfg" },
    { version: "3.2", file: "test-address-syntax.cfg" },
  ];

  it.each(cases)("$version $file", ({ version, file }) => {
    const path = join(haproxyGitRoot, `haproxy-${version}`, "tests", "conf", file);
    if (!existsSync(path)) {
      return;
    }
    const bundle = loadSchemaBundle(version);
    const content = readFileSync(path, "utf-8");
    const doc = createDocument(content, `file://${file}`);
    const diags = computeDiagnostics(doc as never, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(Array.isArray(diags)).toBe(true);
  });
});
