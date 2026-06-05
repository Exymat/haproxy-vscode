import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const haproxyGitRoot = join(__dirname, "..", "..", "..", "haproxy_git");

export function haproxyConfPath(version: string, ...parts: string[]): string | undefined {
  const path = join(haproxyGitRoot, `haproxy-${version}`, "tests", "conf", ...parts);
  return existsSync(path) ? path : undefined;
}

export function readHaproxyConf(version: string, fileName: string): string | undefined {
  const path = haproxyConfPath(version, fileName);
  return path ? readFileSync(path, "utf-8") : undefined;
}

export function hasHaproxyGit(): boolean {
  return existsSync(haproxyGitRoot);
}
