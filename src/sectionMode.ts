import { ParsedLine } from "./parser";
import { ParsedDocumentReuse } from "./parseCache";
import { HaproxySchema, symbolStringList } from "./schema";

export type RuntimeMode = "tcp" | "http" | "log" | "spop" | "haterm";

export interface RuntimeModeCacheEntry {
  version: number;
  modes: Array<RuntimeMode | null>;
}

interface SectionBlock {
  kind: string;
  name: string | null;
  fromDefaults: string | null;
  explicitMode: RuntimeMode | null;
}

function parseSectionHeader(line: ParsedLine): SectionBlock | null {
  if (!line.isSectionHeader || line.tokens.length === 0) {
    /* v8 ignore next -- runtimeModeForLine only calls this for section headers with tokens */
    return null;
  }
  const kind = line.tokens[0].text.toLowerCase();
  let name: string | null = null;
  let fromDefaults: string | null = null;
  if (line.tokens[1] && line.tokens[1].text.toLowerCase() !== "from") {
    name = line.tokens[1].text;
  }
  for (let i = 1; i < line.tokens.length - 1; i += 1) {
    if (line.tokens[i].text.toLowerCase() === "from") {
      fromDefaults = line.tokens[i + 1].text;
      break;
    }
  }
  return { kind, name, fromDefaults, explicitMode: null };
}

const runtimeModeSetCache = new WeakMap<HaproxySchema, Set<string>>();

function runtimeModeSet(schema: HaproxySchema): Set<string> {
  const cached = runtimeModeSetCache.get(schema);
  if (cached) {
    return cached;
  }
  const result = new Set(symbolStringList(schema, "runtime_modes"));
  runtimeModeSetCache.set(schema, result);
  return result;
}

function isRuntimeMode(value: string, schema: HaproxySchema): value is RuntimeMode {
  return runtimeModeSet(schema).has(value);
}

export function runtimeModeForLine(
  parsed: ParsedLine[],
  schema: HaproxySchema,
): Array<RuntimeMode | null> {
  const blocks: SectionBlock[] = [];
  const blockByLine = new Map<number, number>();
  let currentBlock = -1;
  for (const line of parsed) {
    if (line.isSectionHeader) {
      const block = parseSectionHeader(line);
      if (block) {
        blocks.push(block);
        currentBlock = blocks.length - 1;
      }
    }
    blockByLine.set(line.line, currentBlock);
    const t0 = line.tokens[0]?.text.toLowerCase();
    const t1 = line.tokens[1]?.text.toLowerCase();
    if (currentBlock >= 0 && t0 === "mode" && t1 && isRuntimeMode(t1, schema)) {
      blocks[currentBlock].explicitMode = t1;
    }
  }

  const memo = new Map<number, RuntimeMode | null>();
  const resolving = new Set<number>();
  const findNamedDefaultsBefore = (idx: number, name: string): number =>
    (() => {
      for (let i = idx - 1; i >= 0; i -= 1) {
        /* v8 ignore next -- named-defaults fallback is only used when a matching profile exists */
        if (blocks[i].kind === "defaults" && blocks[i].name === name) {
          return i;
        }
      }
      return -1;
    })();
  const findPreviousDefaults = (idx: number): number =>
    (() => {
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (blocks[i].kind === "defaults") {
          return i;
        }
      }
      return -1;
    })();

  const resolveMode = (idx: number): RuntimeMode | null => {
    const hit = memo.get(idx);
    if (hit !== undefined) {
      return hit;
    }
    /* v8 ignore next -- defaults inheritance only resolves backward, so cycles are unreachable */
    if (resolving.has(idx)) {
      return null;
    }
    resolving.add(idx);
    const block = blocks[idx];
    let mode: RuntimeMode | null = block.explicitMode;
    if (!block.explicitMode) {
      let parent = -1;
      if (block.fromDefaults) {
        parent = findNamedDefaultsBefore(idx, block.fromDefaults);
      } else if (block.kind !== "defaults") {
        parent = findPreviousDefaults(idx);
      }
      if (parent >= 0) {
        mode = resolveMode(parent);
      }
    }
    resolving.delete(idx);
    memo.set(idx, mode);
    return mode;
  };

  return parsed.map((line) => {
    /* v8 ignore next -- sparse block maps fall back to null for out-of-block lines */
    const idx = blockByLine.get(line.line) ?? -1;
    return idx >= 0 ? resolveMode(idx) : null;
  });
}

function changedLinesCanReuseModes(parsed: ParsedLine[], reuse: ParsedDocumentReuse): boolean {
  if (reuse.previousVersion === null || reuse.prefixLines === parsed.length) {
    return true;
  }
  if (reuse.prefixLines + reuse.suffixLines !== parsed.length) {
    return false;
  }
  for (let i = reuse.prefixLines; i < reuse.newSuffixStart; i += 1) {
    const line = parsed[i];
    const t0 = line.tokens[0]?.text.toLowerCase();
    if (line.isSectionHeader || t0 === "mode") {
      return false;
    }
  }
  return true;
}

export function runtimeModeForDocument(
  parsed: ParsedLine[],
  version: number,
  reuse: ParsedDocumentReuse,
  previous: RuntimeModeCacheEntry | undefined,
  schema: HaproxySchema,
): RuntimeModeCacheEntry {
  if (
    previous &&
    previous.version === reuse.previousVersion &&
    previous.modes.length === parsed.length &&
    changedLinesCanReuseModes(parsed, reuse)
  ) {
    return {
      version,
      modes: previous.modes,
    };
  }
  return {
    version,
    modes: runtimeModeForLine(parsed, schema),
  };
}
