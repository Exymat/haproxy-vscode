import * as vscode from "vscode";

import { filterByPrefix } from "../helpers";
import { HaproxySchema } from "../../schema";
import {
  getSymbolIndex,
  getWorkspaceSymbolIndex,
  listDefinitionNames,
  resolveExpectedSymbolReferenceAtCompletion,
  SymbolKind,
  workspaceUriKey,
} from "../../symbolIndex";
import { CompletionContext } from "../types";

const SYMBOL_KIND_DETAIL: Record<SymbolKind, string> = {
  "proxy-section": "backend",
  "defaults-profile": "defaults profile",
  server: "server",
  acl: "ACL",
  filter: "filter",
  cache: "cache",
  userlist: "userlist",
  resolvers: "resolvers",
  peers: "peers",
  "environment-variable": "environment variable",
};

const SYMBOL_KIND_ITEM_KIND: Record<SymbolKind, vscode.CompletionItemKind> = {
  "proxy-section": vscode.CompletionItemKind.Class,
  "defaults-profile": vscode.CompletionItemKind.Interface,
  server: vscode.CompletionItemKind.Property,
  acl: vscode.CompletionItemKind.Variable,
  filter: vscode.CompletionItemKind.Method,
  cache: vscode.CompletionItemKind.Struct,
  userlist: vscode.CompletionItemKind.Enum,
  resolvers: vscode.CompletionItemKind.Reference,
  peers: vscode.CompletionItemKind.Reference,
  "environment-variable": vscode.CompletionItemKind.Constant,
};

function predefinedAclNames(schema: HaproxySchema): string[] {
  return schema.tokens.acl_predefined ?? [];
}

function workspaceDefinitionNames(
  workspaceIndex: NonNullable<ReturnType<typeof getWorkspaceSymbolIndex>>,
  kind: SymbolKind,
  scopeKey: string | null,
): string[] {
  const names = new Set<string>();
  for (const defs of workspaceIndex.definitions.values()) {
    for (const site of defs) {
      if (site.kind !== kind || site.role !== "definition") {
        continue;
      }
      if (workspaceIndex.scopedSymbolKinds.has(kind) && site.scopeKey !== scopeKey) {
        continue;
      }
      names.add(site.name);
    }
  }
  return [...names];
}

function symbolCandidateNames(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  kind: SymbolKind,
  scopeKey: string | null,
  maxLines: number,
): string[] {
  const index = getSymbolIndex(document, schema, maxLines);
  if (!index) {
    return kind === "acl" ? predefinedAclNames(schema) : [];
  }

  const names = new Set(listDefinitionNames(index, kind, scopeKey));
  const workspaceIndex = getWorkspaceSymbolIndex(document);
  if (workspaceIndex?.documents.has(workspaceUriKey(document.uri))) {
    for (const name of workspaceDefinitionNames(workspaceIndex, kind, scopeKey)) {
      names.add(name);
    }
  }

  if (kind === "acl") {
    for (const name of predefinedAclNames(schema)) {
      names.add(name);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function trySymbolReferenceCompletion(
  cc: CompletionContext,
  maxLines: number,
): vscode.CompletionItem[] | null {
  const expected = resolveExpectedSymbolReferenceAtCompletion(cc.document, cc.position, cc.schema);
  if (!expected) {
    return null;
  }

  const names = symbolCandidateNames(
    cc.document,
    cc.schema,
    expected.kind,
    expected.scopeKey,
    maxLines,
  );
  const filtered = filterByPrefix(names, cc.partial);
  if (filtered.length === 0) {
    return [];
  }

  const detail = SYMBOL_KIND_DETAIL[expected.kind];
  const itemKind = SYMBOL_KIND_ITEM_KIND[expected.kind];

  return filtered.map((name) => {
    const item = new vscode.CompletionItem(name, itemKind);
    item.detail = detail;
    return item;
  });
}
