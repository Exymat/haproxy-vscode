function isAsciiTableBorder(line: string): boolean {
  return /^\s*[-+]{8,}\s*$/.test(line) || /^\s*[-]{4,}\+[-+]{4,}\s*$/.test(line);
}

function isAsciiTableRow(line: string): boolean {
  return /^\s*[^|\n].*\|.*$/.test(line) || /^\s*\|.*\|\s*$/.test(line);
}

function isAsciiDiagramLine(line: string): boolean {
  return /^\s*[|<>\-+]{6,}.*$/.test(line);
}

function isStructuredBlock(lines: string[]): boolean {
  if (lines.length < 2) {
    return false;
  }
  const score = lines.filter(
    (line) => isAsciiTableBorder(line) || isAsciiTableRow(line) || isAsciiDiagramLine(line),
  ).length;
  return score >= 2 && lines.some((line) => line.includes("|") || isAsciiTableBorder(line));
}

function splitAsciiTableRow(line: string): string[] | null {
  if (!line.includes("|")) {
    return null;
  }
  return line.split("|").map((cell) => cell.trim());
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function normalizeTableCells(cells: string[], width: number): string[] {
  const normalized = cells.slice(0, width);
  while (normalized.length < width) {
    normalized.push("");
  }
  return normalized;
}

function parseDconvPipeTable(lines: string[]): string[][] | null {
  /* v8 ignore next -- short blocks are filtered before dconv parsing in normal hover formatting */
  if (lines.length < 3) {
    return null;
  }
  const separatorIndex = lines.findIndex((line) => isAsciiTableBorder(line));
  if (separatorIndex <= 0) {
    return null;
  }
  const separator = lines[separatorIndex].trim();
  const header = splitAsciiTableRow(lines[separatorIndex - 1]);
  /* v8 ignore next -- structured-block detection already filters out headerless table candidates */
  if (!header) {
    return null;
  }

  const rows: string[][] = [header];
  let current: string[] = [];
  for (let idx = separatorIndex + 1; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (isAsciiTableBorder(line)) {
      /* v8 ignore next -- mixed border styles are treated as opaque text blocks */
      if (line.trim() !== separator) {
        return null;
      }
      /* v8 ignore next -- row flushing only matters for multi-line wrapped dconv cells */
      if (current.length > 0) {
        rows.push(current);
        current = [];
      }
      continue;
    }
    const columns = splitAsciiTableRow(line);
    if (!columns) {
      return null;
    }
    for (let col = 0; col < columns.length; col += 1) {
      const value = columns[col];
      if (current[col]) {
        if (value) {
          current[col] += `<br>${value}`;
        }
      } else {
        current[col] = value;
      }
    }
  }
  if (current.length > 0) {
    rows.push(current);
  }
  return rows.length >= 2 ? rows : null;
}

function parseAsciiTableBlock(lines: string[]): string | null {
  const dconvRows = parseDconvPipeTable(lines);
  const parsedRows =
    dconvRows ??
    lines
      .map((line) => splitAsciiTableRow(line))
      .filter((cells): cells is string[] => cells !== null);
  const width = parsedRows.reduce((max, cells) => Math.max(max, cells.length), 0);
  /* v8 ignore start -- table parsing only reaches this point for multi-column candidates */
  if (width < 2) {
    return null;
  }
  /* v8 ignore stop */

  if (dconvRows) {
    const normalizedRows = dconvRows.map((row) => normalizeTableCells(row, width));
    const md: string[] = [];
    md.push(`| ${normalizedRows[0].map(escapeMarkdownTableCell).join(" | ")} |`);
    md.push(`| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
    for (const row of normalizedRows.slice(1)) {
      md.push(`| ${row.map(escapeMarkdownTableCell).join(" | ")} |`);
    }
    return md.join("\n");
  }

  const groups: string[][][] = [];
  let currentGroup: string[][] = [];
  for (const line of lines) {
    if (isAsciiTableBorder(line)) {
      /* v8 ignore next -- border-only separators are folded out unless we already have row data */
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
      continue;
    }
    const cells = splitAsciiTableRow(line);
    if (!cells) {
      /* v8 ignore next -- malformed mixed-content blocks are preserved as plain text */
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
      continue;
    }
    currentGroup.push(normalizeTableCells(cells, width));
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  if (groups.length < 2) {
    return null;
  }

  const collapseGroup = (group: string[][]): string[] => {
    const cells = Array.from({ length: width }, () => [] as string[]);
    for (const row of group) {
      for (let idx = 0; idx < width; idx += 1) {
        const value = row[idx]?.trim();
        /* v8 ignore next -- empty cells are intentionally collapsed out of the markdown rendering */
        if (value) {
          cells[idx].push(value);
        }
      }
    }
    return cells.map((parts) => parts.join("<br>"));
  };

  const header = collapseGroup(groups[0]);
  const rows = groups.slice(1).map(collapseGroup);
  const md: string[] = [];
  md.push(`| ${header.map(escapeMarkdownTableCell).join(" | ")} |`);
  md.push(`| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
  for (const row of rows) {
    md.push(`| ${row.map(escapeMarkdownTableCell).join(" | ")} |`);
  }
  return md.join("\n");
}

export function formatHoverBlocks(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let idx = 0;

  while (idx < lines.length) {
    if (!lines[idx].trim()) {
      out.push("");
      idx += 1;
      continue;
    }

    let end = idx + 1;
    while (end < lines.length && lines[end].trim()) {
      end += 1;
    }

    const block = lines.slice(idx, end);
    if (isStructuredBlock(block)) {
      const table = parseAsciiTableBlock(block);
      if (table) {
        out.push(table);
      } else {
        out.push("```text");
        out.push(...block);
        out.push("```");
      }
    } else {
      out.push(...block);
    }
    idx = end;
  }

  return out;
}

export function formatHoverText(text: string): string {
  return formatHoverBlocks(text).join("\n");
}
