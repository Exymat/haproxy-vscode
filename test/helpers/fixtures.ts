import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const fixturesRoot = join(__dirname, "..", "fixtures");
const goldenRoot = join(fixturesRoot, "golden");

export function readFixture(...parts: string[]): string {
  return readFileSync(join(fixturesRoot, ...parts), "utf-8");
}

export function readGoldenFixture(fileName: string): string {
  return readFileSync(join(goldenRoot, fileName), "utf-8");
}

export function listGoldenFixtures(): string[] {
  return readdirSync(goldenRoot)
    .filter((name) => name.endsWith(".cfg"))
    .sort();
}
