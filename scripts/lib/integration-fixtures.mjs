import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const SOURCE_FIXTURES_DIR = join(REPO_ROOT, "test/integration/fixtures");
export const FIXTURES_ENV = "HAPROXY_INTEGRATION_FIXTURES_DIR";
export const WORKSPACE_ENV = "HAPROXY_INTEGRATION_WORKSPACE";
export const FOLDER_SCOPED_WORKSPACE_ENV = "HAPROXY_INTEGRATION_FOLDER_SCOPED_WORKSPACE";
export const USER_DATA_DIR_ENV = "HAPROXY_INTEGRATION_USER_DATA_DIR";

export function stageIntegrationFixtures() {
  const tempDir = mkdtempSync(join(tmpdir(), "haproxy-vscode-integration-"));
  const fixturesDir = join(tempDir, "fixtures");
  const folderA = join(tempDir, "folder-a");
  const folderB = join(tempDir, "folder-b");
  const userDataDir = join(tempDir, "user-data");
  cpSync(SOURCE_FIXTURES_DIR, fixturesDir, { recursive: true });
  mkdirSync(folderA, { recursive: true });
  mkdirSync(folderB, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });

  const workspace = join(tempDir, "integration.code-workspace");
  writeFileSync(
    workspace,
    `${JSON.stringify(
      {
        folders: [
          { path: fixturesDir, name: "fixtures" },
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

  return { tempDir, fixturesDir, folderA, folderB, workspace, userDataDir };
}

export function cleanupStagedFixtures(tempDir) {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
