import * as vscode from "vscode";

import { isEnvironmentVariableName } from "./environmentVariables";
import { findInvalidNameChar } from "./nameValidation";
import { HaproxySchema } from "./schema";
import { findAllSites, findDefinitions, findSiteAtPosition, getSymbolIndex } from "./symbolIndex";
import { SymbolSite } from "./symbolIndex/types";

function siteRange(site: SymbolSite): vscode.Range {
  return new vscode.Range(site.line, site.start, site.line, site.end);
}

function resolveRenameSite(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  maxLines: number,
): { index: NonNullable<ReturnType<typeof getSymbolIndex>>; site: SymbolSite } | null {
  const index = getSymbolIndex(document, schema, maxLines);
  if (!index) {
    return null;
  }
  const site = findSiteAtPosition(index, position);
  if (!site) {
    return null;
  }
  return { index, site };
}

function validateNewName(newName: string, kind: SymbolSite["kind"]): void {
  if (kind === "environment-variable") {
    if (!newName) {
      throw new Error("HAProxy environment variable names cannot be empty.");
    }
    if (!isEnvironmentVariableName(newName)) {
      throw new Error(
        "HAProxy environment variable names must start with a letter or underscore and contain only letters, digits, and underscores.",
      );
    }
    return;
  }

  const invalid = findInvalidNameChar(newName);
  if (invalid !== null) {
    if (invalid === "") {
      throw new Error("HAProxy symbol names cannot be empty.");
    }
    throw new Error(`HAProxy symbol names cannot contain '${invalid}'.`);
  }
}

function siteEditKey(site: SymbolSite): string {
  return [site.line, site.start, site.end].join(":");
}

export function prepareRename(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  maxLines: number,
): { range: vscode.Range; placeholder: string } | null {
  const resolved = resolveRenameSite(document, position, schema, maxLines);
  if (!resolved) {
    return null;
  }
  return {
    range: siteRange(resolved.site),
    placeholder: resolved.site.name,
  };
}

export function provideRenameEdits(
  document: vscode.TextDocument,
  position: vscode.Position,
  newName: string,
  schema: HaproxySchema,
  maxLines: number,
): vscode.WorkspaceEdit | null {
  const resolved = resolveRenameSite(document, position, schema, maxLines);
  if (!resolved) {
    return null;
  }

  validateNewName(newName, resolved.site.kind);

  const { index, site } = resolved;
  const oldName = site.name;
  const caseOnlyRename = oldName.toLowerCase() === newName.toLowerCase();
  if (!caseOnlyRename && findDefinitions(index, site.kind, newName, site.scopeKey).length > 0) {
    throw new Error(`A ${site.kind} named '${newName}' already exists in this scope.`);
  }

  const edit = new vscode.WorkspaceEdit();
  const edited = new Set<string>();
  for (const target of findAllSites(index, site.kind, oldName, site.scopeKey)) {
    const key = siteEditKey(target);
    if (edited.has(key)) {
      continue;
    }
    edited.add(key);
    edit.replace(document.uri, siteRange(target), newName);
  }
  return edit;
}
