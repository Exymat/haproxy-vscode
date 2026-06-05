import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { HaproxyVersion } from "./version";

const ACTIVE_GRAMMAR = "haproxy-active.tmLanguage.json";

export function grammarPathForVersion(extensionPath: string, version: HaproxyVersion): string {
  return path.join(extensionPath, "syntaxes", `haproxy-${version}.tmLanguage.json`);
}

export function activeGrammarPath(extensionPath: string): string {
  return path.join(extensionPath, "syntaxes", ACTIVE_GRAMMAR);
}

/** Copy version-specific grammar to the path referenced by package.json. Returns true if the file changed. */
export function syncActiveGrammar(
  context: vscode.ExtensionContext,
  version: HaproxyVersion,
): boolean {
  const src = grammarPathForVersion(context.extensionPath, version);
  const dst = activeGrammarPath(context.extensionPath);
  if (!fs.existsSync(src)) {
    return false;
  }
  const next = fs.readFileSync(src);
  if (fs.existsSync(dst)) {
    const current = fs.readFileSync(dst);
    if (current.equals(next)) {
      return false;
    }
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, next);
  return true;
}

export async function promptReloadIfGrammarChanged(changed: boolean): Promise<void> {
  if (!changed) {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "HAProxy version changed; reload the window to refresh syntax highlighting.",
    "Reload Window",
  );
  if (choice === "Reload Window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}
