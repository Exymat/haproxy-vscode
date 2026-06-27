import * as vscode from "vscode";

import { DiagnosticContext } from "./diagnosticContext";
import { diagRange, diagRangeForTokens, makeDiagnostic } from "./diagnosticUtils";
import { conditionalStartIndex } from "./directiveUtils";
import { resolveLineOptionStartIndex } from "./hover/lineOptions";
import { ParsedLine } from "./parser";
import { HaproxySchema, keywordGroupSet, prefixFamilySet, prefixSubcommandSet } from "./schema";
import { RuntimeMode } from "./sectionMode";
import { resolveSubcommandSpan } from "./tokenUtils";

export { unknownNestedDiagnostics } from "./nestedKeywordHandlers";

function keywordSections(schema: HaproxySchema, keyword: string): string[] {
  return schema.keywords[keyword.toLowerCase()]?.sections ?? [];
}

function wrongSectionMessage(keyword: string, section: string, sections: string[]): string {
  if (sections.length <= 3) {
    return `'${keyword}' is not supported in section '${section}' (allowed in: ${sections.join(", ")})`;
  }
  return `'${keyword}' is not supported in section '${section}'`;
}

function isOptionLine(line: ParsedLine): boolean {
  const t0 = line.tokens[0]?.text.toLowerCase();
  const t1 = line.tokens[1]?.text.toLowerCase();
  return t0 === "option" || (t0 === "no" && t1 === "option");
}

function optionAllowedInSection(memo: { hasOptionKeywords: boolean }): boolean {
  return memo.hasOptionKeywords;
}

function wrongContextMessage(keyword: string, mode: RuntimeMode, contexts: string[]): string {
  return `'${keyword}' is not supported in mode '${mode}' (allowed in: ${contexts.join(", ")})`;
}

function modeContextDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  keyword: string,
  contexts: string[],
  mode: RuntimeMode | null,
): vscode.Diagnostic | null {
  if (!mode || contexts.length === 0) {
    /* c8 ignore next -- contextDiagnostics callers already guarantee both mode and non-empty contexts */
    return null;
  }
  let hasModeContext = false;
  let modeSupported = false;
  for (const context of contexts) {
    const normalized = context.toLowerCase();
    if (normalized === "tcp" || normalized === "http" || normalized === "log") {
      hasModeContext = true;
      if (normalized === mode) {
        modeSupported = true;
        break;
      }
    }
  }
  if (!hasModeContext || modeSupported) {
    return null;
  }
  return makeDiagnostic(
    diagRange(line, tokenIndex),
    wrongContextMessage(keyword, mode, contexts),
    vscode.DiagnosticSeverity.Warning,
    "wrong-context",
  );
}

export function topLevelDiagnostics(ctx: DiagnosticContext, line: ParsedLine): vscode.Diagnostic[] {
  const { allowed, directiveMatch: match, hasOptionKeywords } = ctx.getLineMemo(line);
  if (match.matched) {
    return [];
  }

  if (isOptionLine(line) && optionAllowedInSection({ hasOptionKeywords })) {
    return [];
  }

  const range = diagRangeForTokens(line, match.start, Math.max(match.end, match.start));
  const keyword = match.keyword;
  const section = line.section ?? "none";
  const otherSections = keywordSections(ctx.schema, keyword);

  if (otherSections.length > 0 && line.section && !otherSections.includes(line.section)) {
    return [
      makeDiagnostic(
        range,
        wrongSectionMessage(keyword, section, otherSections),
        vscode.DiagnosticSeverity.Error,
        "wrong-section",
      ),
    ];
  }

  const prefix = line.tokens[0]?.text.toLowerCase();
  if (prefix && prefixFamilySet(ctx.schema).has(prefix)) {
    const sub = resolveSubcommandSpan(
      line,
      allowed,
      prefix,
      prefixSubcommandSet(ctx.schema, prefix),
    );
    if (sub && !sub.matched) {
      return [
        makeDiagnostic(
          diagRangeForTokens(line, sub.start, sub.end),
          `Unknown ${prefix} subcommand '${sub.subcommand}' in section '${section}'`,
          vscode.DiagnosticSeverity.Error,
          "unknown-keyword",
        ),
      ];
    }
  }

  if (otherSections.length > 0) {
    return [
      makeDiagnostic(
        range,
        wrongSectionMessage(keyword, section, otherSections),
        vscode.DiagnosticSeverity.Error,
        "wrong-section",
      ),
    ];
  }

  return [
    makeDiagnostic(
      range,
      `Unknown keyword '${keyword}' in section '${section}'`,
      vscode.DiagnosticSeverity.Error,
      "unknown-keyword",
    ),
  ];
}

export function contextDiagnostics(ctx: DiagnosticContext, line: ParsedLine): vscode.Diagnostic[] {
  const mode = ctx.modeForLine(line);
  if (!mode || line.tokens.length === 0) {
    return [];
  }
  const { directiveMatch: top, statementRule: rule } = ctx.getLineMemo(line);
  const diagnostics: vscode.Diagnostic[] = [];
  const t0 = line.tokens[0]?.text.toLowerCase();
  const t1 = line.tokens[1]?.text.toLowerCase();

  if (top.matched) {
    const kw = ctx.schema.keywords[top.keyword.toLowerCase()];
    if (kw?.contexts?.length) {
      const diag = modeContextDiagnostic(line, top.start, kw.name, kw.contexts, mode);
      if (diag) {
        diagnostics.push(diag);
      }
    }
  }

  if (t0 === "option" || (t0 === "no" && t1 === "option")) {
    const idx = t0 === "option" ? 1 : 2;
    const option = line.tokens[idx]?.text.toLowerCase();
    if (option) {
      const contexts = ctx.schema.keyword_group_contexts?.options?.[option];
      if (contexts?.length) {
        const diag = modeContextDiagnostic(line, idx, `option ${option}`, contexts, mode);
        if (diag) {
          diagnostics.push(diag);
        }
      }
    }
  }

  if (t0 === "bind" || t0 === "server" || t0 === "default-server") {
    const groupName = rule?.group;
    const start = resolveLineOptionStartIndex(line, rule);
    if (groupName && start >= 0) {
      const groupContexts = ctx.schema.keyword_group_contexts?.[groupName] ?? {};
      if (Object.keys(groupContexts).length === 0) {
        return diagnostics;
      }
      const allowedGroup = keywordGroupSet(ctx.schema, groupName);
      const limit = conditionalStartIndex(line, 0);
      for (let i = start; i < limit; i += 1) {
        const option = line.tokens[i].text.toLowerCase().replace(/\*$/, "");
        if (!allowedGroup.has(option)) {
          continue;
        }
        const contexts = groupContexts[option];
        if (!contexts?.length) {
          continue;
        }
        const diag = modeContextDiagnostic(line, i, option, contexts, mode);
        if (diag) {
          diagnostics.push(diag);
        }
      }
    }
  }

  return diagnostics;
}
