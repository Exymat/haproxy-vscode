import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const SOURCE_FIXTURES_DIR = join(REPO_ROOT, "test/integration/fixtures");
export const FIXTURES_ENV = "HAPROXY_INTEGRATION_FIXTURES_DIR";

export function stageIntegrationFixtures() {
  const tempDir = mkdtempSync(join(tmpdir(), "haproxy-vscode-integration-"));
  const fixturesDir = join(tempDir, "fixtures");
  cpSync(SOURCE_FIXTURES_DIR, fixturesDir, { recursive: true });
  return { tempDir, fixturesDir };
}

export function cleanupStagedFixtures(tempDir) {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
