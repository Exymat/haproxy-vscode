/** Offers filesystem path completions for directive arguments marked as paths. */
import * as vscode from "vscode";

import { slotForPosition } from "../../diagnostics/argumentSlotValidation";
import { getKeywordFromSchema } from "../../language/directiveUtils";
import {
  directiveArgumentPosition,
  getLineSemanticContext,
} from "../../parser/lineSemanticContext";
import { SchemaKeyword } from "../../schema/types";
import { CompletionContext } from "../types";

const MAX_PATH_RESULTS = 100;
const MAX_PATH_SCAN_RESULTS = 1000;
const CACHE_TTL_MS = 5000;

interface PathSearchCacheEntry {
  expiresAt: number;
  uris: Thenable<vscode.Uri[]>;
}

const pathSearchCache = new Map<string, PathSearchCacheEntry>();

function pathPrefix(partial: string): string {
  return partial.replace(/^['"]|['"]$/g, "");
}

function fileName(uri: vscode.Uri): string {
  const parts = uri.fsPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? uri.fsPath;
}

function pathMatchesPrefix(candidate: string, prefix: string): boolean {
  if (!prefix) {
    return true;
  }
  return candidate.toLowerCase().includes(prefix.toLowerCase());
}

function pathSlotForKeyword(
  keyword: { argument_model?: SchemaKeyword["argument_model"] } | undefined,
  position: number,
): boolean {
  const model = keyword?.argument_model;
  if (!model) {
    return false;
  }
  return slotForPosition(model, position)?.value_kind === "path";
}

function resolvePathKeyword(
  cc: CompletionContext,
  semantic: NonNullable<ReturnType<typeof getLineSemanticContext>>,
): string | null {
  const directiveKeyword = semantic.directive.keyword.toLowerCase();
  if (pathSlotForKeyword(semantic.resolvedSchemaKeyword, directiveArgumentPosition(semantic))) {
    return directiveKeyword;
  }

  const tokenIndex = semantic.ctx.tokenIndex;
  for (let index = tokenIndex - 1; index > semantic.directive.end; index -= 1) {
    const keyword = semantic.ctx.line.tokens[index].text.toLowerCase();
    const schemaKeyword = getKeywordFromSchema(cc.schema, keyword, semantic.ctx.line.section);
    if (pathSlotForKeyword(schemaKeyword, tokenIndex - index - 1)) {
      return keyword;
    }
  }
  return null;
}

function escapeGlobText(value: string): string {
  return value.replace(/([*?[\]{}])/g, "[$1]");
}

function pathSearchPattern(prefix: string): string {
  const leaf = prefix.replace(/\\/g, "/").split("/").at(-1) ?? "";
  return leaf ? `**/*${escapeGlobText(leaf)}*` : "**/*";
}

function cachedWorkspaceFiles(
  folder: vscode.WorkspaceFolder | undefined,
  pattern: string,
): Thenable<vscode.Uri[]> {
  const key = `${folder?.uri.toString() ?? ""}\0${pattern}`;
  const now = Date.now();
  const cached = pathSearchCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.uris;
  }
  const include = folder ? new vscode.RelativePattern(folder, pattern) : pattern;
  const uris = vscode.workspace.findFiles(
    include,
    "**/{node_modules,.git,dist,out,vendor}/**",
    MAX_PATH_SCAN_RESULTS,
  );
  pathSearchCache.set(key, { expiresAt: now + CACHE_TTL_MS, uris });
  return uris;
}

export function clearPathCompletionCache(): void {
  pathSearchCache.clear();
}

export async function tryPathCompletion(
  cc: CompletionContext,
): Promise<vscode.CompletionItem[] | null> {
  if (cc.ctx.kind !== "directive-argument") {
    return null;
  }

  const semantic = getLineSemanticContext(cc.document, cc.position, cc.schema, cc.data);
  if (!semantic?.directive.matched) {
    return null;
  }

  const keyword = resolvePathKeyword(cc, semantic);
  if (!keyword) {
    return null;
  }

  const folder = vscode.workspace.getWorkspaceFolder(cc.document.uri);
  const prefix = pathPrefix(cc.partial);
  const uris = await cachedWorkspaceFiles(folder, pathSearchPattern(prefix));
  const items: vscode.CompletionItem[] = [];
  for (const uri of uris) {
    const name = fileName(uri);
    if (!pathMatchesPrefix(name, prefix) && !pathMatchesPrefix(uri.fsPath, prefix)) {
      continue;
    }
    const relative = folder
      ? vscode.workspace.asRelativePath(uri, false)
      : uri.fsPath.replace(/\\/g, "/");
    const item = new vscode.CompletionItem(relative, vscode.CompletionItemKind.File);
    item.detail = keyword;
    item.insertText = relative.includes(" ") ? `"${relative}"` : relative;
    items.push(item);
    if (items.length >= MAX_PATH_RESULTS) {
      break;
    }
  }

  return items.length > 0 ? items : null;
}
