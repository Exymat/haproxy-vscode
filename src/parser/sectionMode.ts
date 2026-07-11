import { ParsedLine } from "./index";
import { ParsedDocumentReuse } from "./parseCache";
import { HaproxySchema } from "../schema/types";
import { symbolStringList } from "../schema/symbols";
import { parseSectionHeader } from "../language/sectionUtils";

export type RuntimeMode = string;

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

function sectionBlockFromLine(line: ParsedLine, schema: HaproxySchema): SectionBlock | null {
  const header = parseSectionHeader(line, schema);
  if (!header) {
    return null;
  }
  return {
    kind: header.sectionType,
    name: header.name,
    fromDefaults: header.profileName,
    explicitMode: null,
  };
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
      const block = sectionBlockFromLine(line, schema);
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
  const defaultsSection =
    typeof schema.symbols?.defaults_section_name === "string"
      ? schema.symbols.defaults_section_name
      : "defaults";
  const findNamedDefaultsBefore = (idx: number, name: string): number =>
    (() => {
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (blocks[i].kind === defaultsSection && blocks[i].name === name) {
          return i;
        }
      }
      return -1;
    })();
  const findPreviousDefaults = (idx: number): number =>
    (() => {
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (blocks[i].kind === defaultsSection) {
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
    const block = blocks[idx];
    let mode: RuntimeMode | null = block.explicitMode;
    if (!block.explicitMode) {
      let parent = -1;
      if (block.fromDefaults) {
        parent = findNamedDefaultsBefore(idx, block.fromDefaults);
      } else if (block.kind !== defaultsSection) {
        parent = findPreviousDefaults(idx);
      }
      if (parent >= 0) {
        mode = resolveMode(parent);
      }
    }
    memo.set(idx, mode);
    return mode;
  };

  return parsed.map((line) => {
    const idx = blockByLine.get(line.line)!;
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
