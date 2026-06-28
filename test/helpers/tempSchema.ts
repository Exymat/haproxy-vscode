import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempSchemaFixture {
  cleanup: () => void;
  extensionPath: string;
  schemasDir: string;
}

export function createTempSchemaFixture(
  prefix: string,
  files: Record<string, string>,
): TempSchemaFixture {
  const extensionPath = mkdtempSync(join(tmpdir(), prefix));
  const schemasDir = join(extensionPath, "schemas");
  mkdirSync(schemasDir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    writeFileSync(join(schemasDir, fileName), content, "utf-8");
  }
  return {
    extensionPath,
    schemasDir,
    cleanup: () => rmSync(extensionPath, { recursive: true, force: true }),
  };
}
