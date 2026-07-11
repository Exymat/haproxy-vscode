import * as vscode from "vscode";

import {
  createBundleLoader,
  ExtensionBundle,
  invalidateBundleLoad,
  isBundleLoadStaleError,
} from "./extensionBundle";
import { HaproxySchema } from "../schema/types";
import { HaproxyVersion } from "./version";

export interface ExtensionBundleService extends vscode.Disposable {
  ensureBundleResilient: (uri?: vscode.Uri) => Promise<ExtensionBundle>;
  safeEnsureBundle: (uri?: vscode.Uri) => Promise<ExtensionBundle | undefined>;
  resolveWorkspaceSchema: (folder: vscode.WorkspaceFolder | undefined) => Promise<HaproxySchema>;
  invalidate: (version?: HaproxyVersion) => void;
  reportBundleError: (message: string) => void;
  resetErrorReporting: () => void;
}

export function bundleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createExtensionBundleService(
  context: vscode.ExtensionContext,
): ExtensionBundleService {
  const { ensureBundleForUri, invalidate } = createBundleLoader(context);
  let bundleErrorShown = false;

  const reportBundleError = (message: string): void => {
    if (!bundleErrorShown) {
      bundleErrorShown = true;
      void vscode.window.showErrorMessage(`HAProxy extension failed to load schema: ${message}`);
    }
  };

  const ensureBundleResilient = (uri?: vscode.Uri): Promise<ExtensionBundle> =>
    ensureBundleForUri(uri).catch((error) => {
      if (isBundleLoadStaleError(error)) {
        return ensureBundleForUri(uri);
      }
      throw error;
    });

  const safeEnsureBundle = (uri?: vscode.Uri): Promise<ExtensionBundle | undefined> =>
    ensureBundleResilient(uri).catch((error) => {
      reportBundleError(bundleErrorMessage(error));
      return undefined;
    });

  const resolveWorkspaceSchema = async (
    folder: vscode.WorkspaceFolder | undefined,
  ): Promise<HaproxySchema> => {
    const bundle = await safeEnsureBundle(folder?.uri);
    if (!bundle) {
      throw new Error("HAProxy schema bundle is unavailable");
    }
    return bundle.schema;
  };

  return {
    ensureBundleResilient,
    safeEnsureBundle,
    resolveWorkspaceSchema,
    invalidate,
    reportBundleError,
    resetErrorReporting() {
      bundleErrorShown = false;
    },
    dispose() {
      bundleErrorShown = false;
      invalidateBundleLoad();
    },
  };
}
