export function parseVersionArgs(argv, defaults = {}) {
  const positional = [];
  let version = defaults.version ?? process.env.HAPROXY_VERSION ?? "3.2";
  let runtime = defaults.runtime ?? process.env.HAPROXY_RUNTIME ?? "local";
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
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

export function parseHighlightArgs(argv) {
  const options = { json: false, summary: false, maxPerFile: 25, path: null };
  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--summary") {
      options.summary = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--max=")) {
      options.maxPerFile = Number.parseInt(arg.slice("--max=".length), 10);
    } else if (!arg.startsWith("-")) {
      options.path = arg;
    }
  }
  return options;
}
