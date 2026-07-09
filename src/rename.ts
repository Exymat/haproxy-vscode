import * as vscode from "vscode";

import { isEnvironmentVariableName } from "./environmentVariables";
import { findInvalidNameChar } from "./nameValidation";
import { HaproxySchema } from "./schema";
import {
  findAllSites,
  findAllWorkspaceSites,
  findDefinitions,
  findSiteAtPosition,
  findWorkspaceDefinitions,
  getSymbolIndex,
  getWorkspaceSymbolIndex,
  workspaceUriKey,
} from "./symbolIndex";
import { SymbolSite } from "./symbolIndex/types";
import { WorkspaceSymbolSite } from "./symbolIndex/workspace";

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

function siteEditKey(site: SymbolSite | WorkspaceSymbolSite): string {
  const uriKey = "uriKey" in site ? site.uriKey : "local";
  return [uriKey, site.line, site.start, site.end].join(":");
}

function workspaceIndexForDocument(document: vscode.TextDocument) {
  const workspaceIndex = getWorkspaceSymbolIndex(document);
  if (!workspaceIndex?.documents.has(workspaceUriKey(document.uri))) {
    return null;
  }
  return workspaceIndex;
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
  const workspaceIndex = workspaceIndexForDocument(document);

  if (!caseOnlyRename) {
    if (workspaceIndex && site.kind !== "environment-variable") {
      if (findWorkspaceDefinitions(workspaceIndex, site.kind, newName, site.scopeKey).length > 0) {
        throw new Error(`A ${site.kind} named '${newName}' already exists in this scope.`);
      }
    } else if (findDefinitions(index, site.kind, newName, site.scopeKey).length > 0) {
      throw new Error(`A ${site.kind} named '${newName}' already exists in this scope.`);
    }
  }

  const useWorkspaceRename = workspaceIndex !== null && site.kind !== "environment-variable";
  let targets: Array<SymbolSite | WorkspaceSymbolSite>;

  if (useWorkspaceRename) {
    const oldDefinitions = findWorkspaceDefinitions(
      workspaceIndex,
      site.kind,
      oldName,
      site.scopeKey,
    );
    if (oldDefinitions.length > 1) {
      throw new Error(
        `Cannot rename ${site.kind} '${oldName}' across workspace because ${oldDefinitions.length} definitions exist in this scope. Narrow haproxy.workspaceSymbols.include or disable workspace symbols.`,
      );
    }
    targets =
      oldDefinitions.length === 1
        ? findAllWorkspaceSites(workspaceIndex, site.kind, oldName, site.scopeKey)
        : findAllSites(index, site.kind, oldName, site.scopeKey);
  } else {
    targets = findAllSites(index, site.kind, oldName, site.scopeKey);
  }

  const edit = new vscode.WorkspaceEdit();
  const edited = new Set<string>();

  for (const target of targets) {
    const key = siteEditKey(target);
    if (edited.has(key)) {
      continue;
    }
    edited.add(key);
    const uri = "uri" in target ? target.uri : document.uri;
    edit.replace(uri, siteRange(target), newName);
  }
  return edit;
}
