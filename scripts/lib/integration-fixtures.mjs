import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const SOURCE_FIXTURES_DIR = join(REPO_ROOT, "test/integration/fixtures");
export const FIXTURES_ENV = "HAPROXY_INTEGRATION_FIXTURES_DIR";
export const FOLDER_SCOPED_WORKSPACE_ENV = "HAPROXY_INTEGRATION_FOLDER_SCOPED_WORKSPACE";

export function stageIntegrationFixtures() {
  const tempDir = mkdtempSync(join(tmpdir(), "haproxy-vscode-integration-"));
  const fixturesDir = join(tempDir, "fixtures");
  const folderA = join(tempDir, "folder-a");
  const folderB = join(tempDir, "folder-b");
  cpSync(SOURCE_FIXTURES_DIR, fixturesDir, { recursive: true });
  mkdirSync(folderA, { recursive: true });
  mkdirSync(folderB, { recursive: true });

  const folderScopedWorkspace = join(tempDir, "folder-scoped.code-workspace");
  writeFileSync(
    folderScopedWorkspace,
    `${JSON.stringify(
      {
        folders: [
          { path: folderA, name: "folder-a" },
          { path: folderB, name: "folder-b" },
        ],
        settings: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { tempDir, fixturesDir, folderA, folderB, folderScopedWorkspace };
}

export function cleanupStagedFixtures(tempDir) {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
