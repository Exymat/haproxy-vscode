import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function collectCfgFiles(path) {
  const st = statSync(path);
  if (st.isFile()) {
    return path.endsWith(".cfg") ? [path] : [];
  }
  const files = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    const entryStat = statSync(full);
    if (entryStat.isDirectory()) {
      files.push(...collectCfgFiles(full));
    } else if (entry.endsWith(".cfg")) {
      files.push(full);
    }
  }
  return files.sort();
}

export function schemaPath(extensionRoot, version) {
  return join(extensionRoot, "schemas", `haproxy-${version}.schema.json`);
}

export function languageDataPath(extensionRoot, version) {
  return join(extensionRoot, "schemas", `haproxy-${version}.language.json`);
}
