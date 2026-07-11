export function parseVersionArgs(argv, defaults = {}) {
  const positional = [];
  let version = defaults.version ?? process.env.HAPROXY_VERSION ?? "3.2";
  let runtime = defaults.runtime ?? process.env.HAPROXY_RUNTIME ?? "local";
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === "--matrix") {
      continue;
    }
    if (arg === "--version") {
      version = argv[idx + 1] ?? version;
      idx += 1;
      continue;
    }
    if (arg === "--runtime") {
      runtime = argv[idx + 1] ?? runtime;
      idx += 1;
      continue;
    }
    positional.push(arg);
  }
  return { version, runtime, positional };
}
