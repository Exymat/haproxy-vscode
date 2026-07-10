import * as vscode from "vscode";

import { invalidateBundleLoad } from "./extensionBundle";
import { createExtensionBundleService, ExtensionBundleService } from "./extensionBundleService";
import {
  createExtensionDiagnosticsService,
  ExtensionDiagnosticsService,
} from "./extensionDiagnosticsService";
import { registerExtensionLifecycle } from "./extensionLifecycle";
import { registerExtensionProviders } from "./extensionProviders";
import {
  createExtensionWorkspaceSymbolService,
  ExtensionWorkspaceSymbolService,
} from "./extensionWorkspaceSymbols";
import { logExtensionActivated, registerHaproxyOutputChannel } from "./outputChannel";
import { getExtensionSettings, HaproxyExtensionSettings } from "./settings";
import { registerVersionStatusBar } from "./statusBar";
import { clearWorkspaceSymbolIndex, setWorkspaceSymbolIndexChangeListener } from "./symbolIndex";
import { registerWorkspaceIndexStatusBar } from "./workspaceIndexStatusBar";

let activeBundleService: ExtensionBundleService | undefined;
let activeDiagnosticsService: ExtensionDiagnosticsService | undefined;
let activeWorkspaceSymbolService: ExtensionWorkspaceSymbolService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const extensionVersion = (context.extension.packageJSON as { version: string }).version;
  registerHaproxyOutputChannel(context);
  logExtensionActivated(extensionVersion);

  let cachedSettings: HaproxyExtensionSettings = getExtensionSettings();
  const getSettings = (): HaproxyExtensionSettings => cachedSettings;
  const refreshSettings = (): void => {
    cachedSettings = getExtensionSettings();
  };

  const refreshWorkspaceIndexStatusBar = registerWorkspaceIndexStatusBar(context);
  registerVersionStatusBar(context);

  const bundle = createExtensionBundleService(context);
  const diagnostics = createExtensionDiagnosticsService(context, {
    getSettings,
    ensureBundle: (document) => bundle.ensureBundleResilient(document.uri),
    onBundleError: bundle.reportBundleError,
  });
  const workspaceSymbols = createExtensionWorkspaceSymbolService({
    getSettings,
    getMaxDiagnosticsLines: () => getSettings().maxDiagnosticsLines,
    resolveWorkspaceSchema: bundle.resolveWorkspaceSchema,
    safeEnsureBundle: bundle.safeEnsureBundle,
    scheduler: diagnostics.scheduler,
    refreshWorkspaceIndexStatusBar,
  });

  activeBundleService = bundle;
  activeDiagnosticsService = diagnostics;
  activeWorkspaceSymbolService = workspaceSymbols;

  workspaceSymbols.configureWatchers();

  registerExtensionLifecycle({
    context,
    extensionVersion,
    getSettings,
    refreshSettings,
    bundle,
    diagnostics,
    workspaceSymbols,
  });

  registerExtensionProviders(context, {
    getSettings,
    safeEnsureBundle: bundle.safeEnsureBundle,
  });
}

export function deactivate(): void {
  activeDiagnosticsService?.dispose();
  activeDiagnosticsService = undefined;
  activeWorkspaceSymbolService?.dispose();
  activeWorkspaceSymbolService = undefined;
  activeBundleService?.dispose();
  activeBundleService = undefined;
  setWorkspaceSymbolIndexChangeListener(undefined);
  clearWorkspaceSymbolIndex();
  invalidateBundleLoad();
}
