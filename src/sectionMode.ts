import { ParsedLine } from "./parser";

export type RuntimeMode = "tcp" | "http" | "log" | "spop" | "haterm";

interface SectionBlock {
  kind: string;
  name: string | null;
  fromDefaults: string | null;
  explicitMode: RuntimeMode | null;
}

function parseSectionHeader(line: ParsedLine): SectionBlock | null {
  if (!line.isSectionHeader || line.tokens.length === 0) {
    /* c8 ignore next -- runtimeModeForLine only calls this for section headers with tokens */
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

function isRuntimeMode(value: string): value is RuntimeMode {
  return (
    value === "tcp" || value === "http" || value === "log" || value === "spop" || value === "haterm"
  );
}

export function runtimeModeForLine(parsed: ParsedLine[]): Array<RuntimeMode | null> {
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
    if (currentBlock >= 0 && t0 === "mode" && t1 && isRuntimeMode(t1)) {
      blocks[currentBlock].explicitMode = t1;
    }
  }

  const memo = new Map<number, RuntimeMode | null>();
  const resolving = new Set<number>();
  const findNamedDefaultsBefore = (idx: number, name: string): number =>
    (() => {
      for (let i = idx - 1; i >= 0; i -= 1) {
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
    if (resolving.has(idx)) {
      /* c8 ignore next -- defaults inheritance only resolves backward, so cycles are unreachable */
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
    const idx = blockByLine.get(line.line) ?? -1;
    return idx >= 0 ? resolveMode(idx) : null;
  });
}
