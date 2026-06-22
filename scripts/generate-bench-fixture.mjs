#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const defaultOutputDir = join(repoRoot, "test", "bench", "fixtures");

const FILE_PROFILES = {
  "large-valid.cfg": {
    fixtureType: "valid",
    profile: "tokenize",
    description: "Mostly valid sections for tokenization, navigation, formatting, and completion.",
    targetLines: 24000,
    seed: 1337,
    invalidEvery: 0,
    sectionMix: {
      validBackendEvery: 1,
      validFrontendEvery: 4,
      validListenEvery: 6,
      fillerEvery: 3,
    },
  },
  "large-mixed.cfg": {
    fixtureType: "mixed",
    profile: "diagnostics",
    description:
      "Valid baseline plus deliberate syntax and context failures for diagnostics stress.",
    targetLines: 24000,
    seed: 4242,
    invalidEvery: 5,
    sectionMix: {
      validBackendEvery: 1,
      validFrontendEvery: 4,
      validListenEvery: 6,
      fillerEvery: 2,
    },
  },
};

const PROFILE_PRESETS = {
  tokenize: { targetLines: 24000, invalidEvery: 0 },
  diagnostics: { targetLines: 24000, invalidEvery: 5 },
  navigation: { targetLines: 18000, invalidEvery: 0 },
  "worst-case": { targetLines: 32000, invalidEvery: 3 },
};

function parseArgs(argv) {
  const options = {
    outDir: defaultOutputDir,
    profile: undefined,
    targetLines: undefined,
    invalidEvery: undefined,
    seed: undefined,
    verify: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (rawKey === "verify") {
      options.verify = true;
      continue;
    }
    const hasInline = inlineValue !== undefined;
    const value = hasInline ? inlineValue : argv[i + 1];
    if (!hasInline) {
      i += 1;
    }
    switch (rawKey) {
      case "out-dir":
        options.outDir = resolve(value);
        break;
      case "profile":
        options.profile = value;
        break;
      case "target-lines":
        options.targetLines = Number(value);
        break;
      case "invalid-every":
        options.invalidEvery = Number(value);
        break;
      case "seed":
        options.seed = Number(value);
        break;
      default:
        throw new Error(`Unknown argument --${rawKey}`);
    }
  }
  return options;
}

function createRng(seed) {
  let state = seed >>> 0;
  return {
    int(maxExclusive) {
      state = (1664525 * state + 1013904223) >>> 0;
      return state % maxExclusive;
    },
    pick(items) {
      return items[this.int(items.length)];
    },
  };
}

function pushBlock(lines, stats, block, category) {
  for (const line of block) {
    lines.push(line);
    stats.lineCount += 1;
  }
  if (category) {
    stats.blocks[category] = (stats.blocks[category] ?? 0) + 1;
  }
}

function incrementError(stats, category) {
  stats.invalidCategories[category] = (stats.invalidCategories[category] ?? 0) + 1;
}

function globalBlock(fileName, profileName, fixtureType) {
  return [
    `# GENERATED FILE: ${fileName}`,
    `# PROFILE: ${profileName}`,
    `# FIXTURE_TYPE: ${fixtureType}`,
    "# BENCH_ANCHOR: front-default-backend bench_api_0000",
    "global",
    "    log stdout format raw local0",
    "    master-worker",
    "    maxconn 200000",
    "    nbthread 8",
    "    stats socket ipv4@127.0.0.1:9999 level admin expose-fd listeners",
    "    ssl-default-bind-options no-sslv3 no-tlsv10",
    "    tune.bufsize 32768",
    "    tune.maxrewrite 4096",
    "",
    "defaults",
    "    log global",
    "    mode http",
    "    option httplog",
    "    option dontlognull",
    "    timeout connect 5s",
    "    timeout client 30s",
    "    timeout server 30s",
    "    retries 3",
    "",
    "resolvers bench_dns",
    "    nameserver dns1 10.0.0.10:53",
    "    nameserver dns2 10.0.0.11:53",
    "    accepted_payload_size 8192",
    "    resolve_retries 3",
    "    timeout resolve 1s",
    "    timeout retry 1s",
    "",
    "cache bench_cache",
    "    total-max-size 256",
    "    max-age 60",
    "",
    "userlist bench_users",
    "    group admins users alice",
    "    user alice insecure-password alicepw groups admins",
    "",
    "peers bench_peers",
    "    peer node1 127.0.0.1:10000",
    "    peer node2 127.0.0.1:10001",
    "",
    "frontend bench_public",
    "    bind :8080",
    "    bind :8443 ssl crt /etc/haproxy/certs/example.pem alpn h2,http/1.1",
    "    option forwardfor",
    "    http-request set-var(txn.req_id) req.hdr(x-request-id),lower",
    "    http-request set-header x-env production if { path_beg /api }",
    "    acl is_api path_beg /api /v1 /v2",
    "    acl wants_cache hdr_sub(cache-control) max-age",
    "    use_backend bench_api_0000 if is_api",
    "    http-response set-header x-cache-status HIT if wants_cache",
    "    default_backend bench_api_0000",
    "",
    "listen bench_stats",
    "    bind :8404",
    "    mode http",
    "    stats enable",
    "    stats uri /stats",
    "    stats refresh 10s",
    "",
  ];
}

function validBackendBlock(index, rng) {
  const padded = String(index).padStart(4, "0");
  const port = 9000 + (index % 1000);
  const balance = rng.pick(["roundrobin", "leastconn", "first"]);
  const method = rng.pick(["GET", "POST", "PUT"]);
  const compressionAlgo = rng.pick(["gzip", "deflate"]);
  return [
    `backend bench_api_${padded}`,
    `    balance ${balance}`,
    "    option httpchk",
    `    http-check send meth ${method} uri /health ver HTTP/1.1 hdr Host bench-${padded}.internal`,
    "    http-check expect status 200",
    `    acl canary_${padded} hdr(x-canary) -i shard-${index % 17}`,
    `    http-request set-header x-backend-id ${padded}`,
    "    http-request cache-use bench_cache if { method GET }",
    "    http-response cache-store bench_cache if { status 200 }",
    `    stick-table type ip size ${1000 + (index % 50) * 100} expire 30m store gpc0,http_req_rate(10s)`,
    "    stick on src",
    `    server-template srv 3 bench-api-${padded}.service.local:${port} check resolvers bench_dns init-addr libc,none`,
    `    server backup1 127.0.0.1:${port + 1000} backup check inter ${2 + (index % 5)}s fall 2 rise 3`,
    `    http-after-response set-header x-compression ${compressionAlgo} if { status 200 }`,
    "",
  ];
}

function validFrontendBlock(index) {
  const padded = String(index).padStart(4, "0");
  const bindPort = 10080 + (index % 2000);
  return [
    `frontend bench_extra_${padded}`,
    `    bind :${bindPort}`,
    "    mode http",
    `    acl route_${padded} path_beg /tenant/${index}`,
    `    use_backend bench_api_${padded} if route_${padded}`,
    "    default_backend bench_api_0000",
    "",
  ];
}

function validListenBlock(index) {
  const padded = String(index).padStart(4, "0");
  const bindPort = 12000 + (index % 2000);
  return [
    `listen bench_tcp_${padded}`,
    `    bind :${bindPort}`,
    "    mode tcp",
    "    option tcplog",
    "    timeout client 1m",
    "    timeout server 1m",
    `    server tcp1 127.0.0.1:${bindPort + 2000} check`,
    `    server tcp2 127.0.0.1:${bindPort + 3000} check backup`,
    "",
  ];
}

function invalidBlocks(index, rng, stats) {
  const padded = String(index).padStart(4, "0");
  const blocks = [];

  incrementError(stats, "unknown-directive");
  blocks.push({
    category: "invalidUnknownDirective",
    lines: [
      `backend broken_unknown_${padded}`,
      "    option definitely-not-real",
      "    madeup-directive force-chaos",
      "",
    ],
  });

  incrementError(stats, "wrong-context");
  blocks.push({
    category: "invalidWrongContext",
    lines: [
      `frontend broken_context_${padded}`,
      `    server misplaced_${padded} 127.0.0.1:${15000 + index} check`,
      "    default_backend bench_api_0000",
      "",
    ],
  });

  incrementError(stats, "truncated-condition");
  blocks.push({
    category: "invalidTruncatedCondition",
    lines: [
      `frontend broken_acl_${padded}`,
      "    bind :0",
      `    acl invalid_acl_${padded} path_beg`,
      `    use_backend bench_api_${padded} if`,
      "",
    ],
  });

  incrementError(stats, "bad-server-address");
  blocks.push({
    category: "invalidBadServerAddress",
    lines: [
      `backend broken_server_${padded}`,
      `    balance madeup-${rng.pick(["algo", "scheduler", "method"])}`,
      "    timeout server banana",
      "    server broken1 127.0.0.1 check",
      "",
    ],
  });

  incrementError(stats, "mismatched-syntax");
  blocks.push({
    category: "invalidMismatchedSyntax",
    lines: [
      `frontend broken_expr_${padded}`,
      "    bind :65536",
      "    http-request set-header x-bad %[req.hdr(host)",
      "    http-response add-header x-oops",
      "",
    ],
  });

  incrementError(stats, "duplicate-conflict");
  blocks.push({
    category: "invalidDuplicateConflict",
    lines: [
      `defaults malformed_defaults_${padded}`,
      "    mode http",
      "    mode tcp",
      "    retries nope",
      "",
    ],
  });

  return blocks;
}

function fillerComment(index) {
  return `# filler-line ${String(index).padStart(5, "0")} expands the file without repeating the exact same syntax shape`;
}

function buildFixture(fileName, settings) {
  const rng = createRng(settings.seed);
  const lines = [];
  const stats = {
    lineCount: 0,
    blocks: {},
    invalidCategories: {},
  };

  pushBlock(lines, stats, globalBlock(fileName, settings.profile, settings.fixtureType), "header");

  let sectionIndex = 0;
  while (lines.length < settings.targetLines) {
    if (sectionIndex % settings.sectionMix.validBackendEvery === 0) {
      pushBlock(lines, stats, validBackendBlock(sectionIndex, rng), "validBackend");
    }
    if (sectionIndex % settings.sectionMix.validFrontendEvery === 0) {
      pushBlock(lines, stats, validFrontendBlock(sectionIndex), "validFrontend");
    }
    if (sectionIndex % settings.sectionMix.validListenEvery === 0) {
      pushBlock(lines, stats, validListenBlock(sectionIndex), "validListen");
    }
    if (settings.invalidEvery > 0 && sectionIndex % settings.invalidEvery === 0) {
      for (const invalid of invalidBlocks(sectionIndex, rng, stats)) {
        pushBlock(lines, stats, invalid.lines, invalid.category);
      }
    }
    if (sectionIndex % settings.sectionMix.fillerEvery === 0) {
      pushBlock(lines, stats, [fillerComment(sectionIndex), ""], "filler");
    }
    sectionIndex += 1;
  }

  const content = `${lines.slice(0, settings.targetLines).join("\n")}\n`;
  return {
    content,
    metadata: {
      fileName,
      fixtureType: settings.fixtureType,
      profile: settings.profile,
      description: settings.description,
      seed: settings.seed,
      targetLines: settings.targetLines,
      actualLines: content.split(/\r?\n/).length - 1,
      invalidEvery: settings.invalidEvery,
      blockCounts: stats.blocks,
      invalidCategories: stats.invalidCategories,
    },
  };
}

function resolveSettings(profile) {
  const preset = PROFILE_PRESETS[profile.profile] ?? {};
  return {
    ...profile,
    ...preset,
    targetLines: profile.targetLines ?? preset.targetLines,
    invalidEvery: profile.invalidEvery ?? preset.invalidEvery,
  };
}

function generateFixtures(outDir, overrides = {}) {
  mkdirSync(outDir, { recursive: true });
  const fixtures = [];
  for (const [fileName, profile] of Object.entries(FILE_PROFILES)) {
    const settings = resolveSettings({
      ...profile,
      ...overrides,
      sectionMix: profile.sectionMix,
      fixtureType: profile.fixtureType,
      description: profile.description,
      profile: overrides.profile ?? profile.profile,
      seed: overrides.seed ?? profile.seed,
      targetLines: overrides.targetLines ?? profile.targetLines,
      invalidEvery: overrides.invalidEvery ?? profile.invalidEvery,
    });
    const built = buildFixture(fileName, settings);
    const filePath = join(outDir, fileName);
    writeFileSync(filePath, built.content, "utf-8");
    fixtures.push(built.metadata);
  }
  const manifest = {
    generator: "scripts/generate-bench-fixture.mjs",
    fixtures,
  };
  const manifestPath = join(outDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return { fixtures, manifestPath };
}

function compareGeneratedDirs(expectedDir, actualDir) {
  const names = ["large-valid.cfg", "large-mixed.cfg", "manifest.json"];
  const mismatches = [];
  for (const name of names) {
    const expected = readFileSync(join(expectedDir, name), "utf-8");
    const actual = readFileSync(join(actualDir, name), "utf-8");
    if (expected !== actual) {
      mismatches.push(name);
    }
  }
  return mismatches;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.verify) {
    const tempDir = join(repoRoot, ".tmp_bench_fixture_verify");
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
    generateFixtures(tempDir, options);
    const mismatches = compareGeneratedDirs(options.outDir, tempDir);
    rmSync(tempDir, { recursive: true, force: true });
    if (mismatches.length > 0) {
      console.error(`Benchmark fixtures are out of date: ${mismatches.join(", ")}`);
      process.exit(1);
    }
    console.log(`Benchmark fixtures are up to date in ${options.outDir}`);
    return;
  }

  const { fixtures, manifestPath } = generateFixtures(options.outDir, options);
  for (const fixture of fixtures) {
    console.log(
      `Generated ${fixture.fileName}: ${fixture.actualLines} lines, profile=${fixture.profile}, invalidEvery=${fixture.invalidEvery}`,
    );
  }
  console.log(`Wrote manifest: ${manifestPath}`);
}

main();
