#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const { parseDocument } = require(join(extensionRoot, "out", "parser.js"));
const {
  buildSymbolIndex,
  resolveSymbolAtPosition,
  findDefinitions,
  findAllSites,
} = require(join(extensionRoot, "out", "symbolIndex.js"));

const schema = JSON.parse(
  readFileSync(join(extensionRoot, "schemas", "haproxy-3.2.schema.json"), "utf-8")
);

function createDocument(content) {
  const lines = content.split(/\r?\n/);
  return {
    uri: { toString: () => "test://fixture" },
    lineCount: lines.length,
    lineAt(lineNo) {
      return { text: lines[lineNo] ?? "" };
    },
  };
}

function pos(line, character) {
  return { line, character };
}

function siteKey(site) {
  return `${site.role}:${site.kind}:${site.name}@${site.line}:${site.start}`;
}

function assertDef(index, kind, name, scopeKey, line, start) {
  const defs = findDefinitions(index, kind, name, scopeKey);
  const hit = defs.find((d) => d.line === line && d.start === start);
  if (!hit) {
    throw new Error(
      `expected definition ${kind}/${name} at line ${line} col ${start}, got ${JSON.stringify(defs)}`
    );
  }
}

function assertRefCount(index, kind, name, scopeKey, count) {
  const sites = findAllSites(index, kind, name, scopeKey);
  if (sites.length !== count) {
    throw new Error(
      `expected ${count} sites for ${kind}/${name}, got ${sites.length}: ${sites.map(siteKey).join(", ")}`
    );
  }
}

function assertResolve(doc, position, expected) {
  const actual = resolveSymbolAtPosition(doc, position, schema);
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `resolve at ${position.line}:${position.character}\n  expected: ${expectedJson}\n  actual:   ${actualJson}`
    );
  }
}

function runCase(name, content, checks) {
  const doc = createDocument(content);
  const parsed = parseDocument(doc);
  const index = buildSymbolIndex(parsed, schema);
  checks({ doc, index });
}

runCase("backend use_backend", "backend api\n    server s1 127.0.0.1:8080\nfrontend web\n    use_backend api", ({ doc, index }) => {
  assertDef(index, "proxy-section", "api", null, 0, "backend api".indexOf("api"));
  assertRefCount(index, "proxy-section", "api", null, 2);
  const useBackendCol = "    use_backend api".indexOf("api");
  assertResolve(doc, pos(3, useBackendCol), { kind: "proxy-section", name: "api", scopeKey: null });
});

runCase("server use-server", "backend api\n    server web1 127.0.0.1:8080\n    use-server web1", ({ doc, index }) => {
  const serverCol = "    server web1".indexOf("web1");
  assertDef(index, "server", "web1", "backend:api", 1, serverCol);
  assertRefCount(index, "server", "web1", "backend:api", 2);
  const useServerCol = "    use-server web1".indexOf("web1");
  assertResolve(doc, pos(2, useServerCol), { kind: "server", name: "web1", scopeKey: "backend:api" });
});

runCase("acl if reference", "frontend web\n    acl is_api path -m beg /api\n    http-request deny if is_api", ({ doc, index }) => {
  const aclCol = "    acl is_api".indexOf("is_api");
  assertDef(index, "acl", "is_api", "frontend:web", 1, aclCol);
  assertRefCount(index, "acl", "is_api", "frontend:web", 2);
  const ifCol = "    http-request deny if is_api".indexOf("is_api");
  assertResolve(doc, pos(2, ifCol), { kind: "acl", name: "is_api", scopeKey: "frontend:web" });
});

runCase("acl negated if reference spaced", "frontend web\n    acl is_api path -m beg /api\n    http-request deny if ! is_api", ({ doc, index }) => {
  assertRefCount(index, "acl", "is_api", "frontend:web", 2);
  const ifCol = "    http-request deny if ! is_api".indexOf("is_api");
  assertResolve(doc, pos(2, ifCol), { kind: "acl", name: "is_api", scopeKey: "frontend:web" });
});

runCase("acl negated if reference compact", "frontend web\n    acl is_api path -m beg /api\n    http-request deny if !is_api", ({ doc, index }) => {
  assertRefCount(index, "acl", "is_api", "frontend:web", 2);
  const ifCol = "    http-request deny if !is_api".indexOf("is_api");
  assertResolve(doc, pos(2, ifCol), { kind: "acl", name: "is_api", scopeKey: "frontend:web" });
});

runCase("filter definition", "backend api\n    filter compression\n        compression algo gzip", ({ index }) => {
  const filterCol = "    filter compression".indexOf("compression");
  assertDef(index, "filter", "compression", "backend:api", 1, filterCol);
});

runCase("name-scopes defaults from", "defaults profile_default from fusion_defaults\ndefaults fusion_defaults\n    mode http", ({ doc, index }) => {
  const fusionCol = "defaults fusion_defaults".indexOf("fusion_defaults");
  assertDef(index, "defaults-profile", "fusion_defaults", null, 1, fusionCol);
  const fromCol = "defaults profile_default from fusion_defaults".indexOf("fusion_defaults");
  assertRefCount(index, "defaults-profile", "fusion_defaults", null, 2);
  assertResolve(doc, pos(0, fromCol), { kind: "defaults-profile", name: "fusion_defaults", scopeKey: null });
});

runCase("name-scopes frontend from", "defaults profile_default\nfrontend FRONTEND_PRD from profile_default", ({ doc, index }) => {
  const profileCol = "defaults profile_default".indexOf("profile_default");
  assertDef(index, "defaults-profile", "profile_default", null, 0, profileCol);
  const fromCol = "frontend FRONTEND_PRD from profile_default".indexOf("profile_default");
  assertResolve(doc, pos(1, fromCol), { kind: "defaults-profile", name: "profile_default", scopeKey: null });
});

runCase("cache section", "cache maintenance_cache\n    total-max-size 4\ndefaults\n    mode http", ({ index }) => {
  const cacheCol = "cache maintenance_cache".indexOf("maintenance_cache");
  assertDef(index, "cache", "maintenance_cache", null, 0, cacheCol);
});

console.log("navigation tests passed: 9");
