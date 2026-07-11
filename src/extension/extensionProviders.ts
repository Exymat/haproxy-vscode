import * as vscode from "vscode";

import { provideCompletionItems } from "../completion";
import { provideDiagnosticSuppressionCodeActions } from "../diagnostics/diagnosticCodeActions";
import { provideDocumentSymbols } from "../navigation/documentSymbols";
import { ExtensionBundle } from "./extensionBundle";
import { formatConfig } from "../formatting";
import { haproxyDocumentSelector } from "./grammar";
import { provideHover } from "../hover";
import { provideDefinition, provideReferences } from "../navigation";
import { prepareRename, provideRenameEdits } from "../navigation/rename";
import { getFormatOptions, HaproxyExtensionSettings } from "./settings";
import { sectionHeaderSet } from "../schema/layout";
import { getWorkspaceSymbolIndex, workspaceUriKey } from "../symbolIndex";
import { provideFoldingRanges } from "../navigation/folding";

interface ExtensionProviderOptions {
  getSettings: () => HaproxyExtensionSettings;
  safeEnsureBundle: (uri?: vscode.Uri) => Promise<ExtensionBundle | undefined>;
}

export function registerExtensionProviders(
  context: vscode.ExtensionContext,
  options: ExtensionProviderOptions,
): void {
  const selector = haproxyDocumentSelector();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "haproxy.peekDefinitionAtPosition",
      async (uriString: string, line: number, character: number) => {
        if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0) {
          return;
        }
        const uri = vscode.Uri.parse(uriString);
        if (uri.scheme !== "file") {
          return;
        }
        const document = await vscode.workspace.openTextDocument(uri);
        const workspaceIndex = getWorkspaceSymbolIndex(document);
        if (workspaceIndex && !workspaceIndex.documents.has(workspaceUriKey(uri))) {
          return;
        }
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const position = new vscode.Position(line, character);
        editor.selection = new vscode.Selection(position, position);
        await vscode.commands.executeCommand("editor.action.peekDefinition");
      },
    ),
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        async provideCompletionItems(document, position) {
          const b = await options.safeEnsureBundle(document.uri);
          if (!b) {
            return [];
          }
          return provideCompletionItems(
            document,
            position,
            b.languageData,
            b.schema,
            options.getSettings().maxDiagnosticsLines,
          );
        },
      },
      " ",
      "\t",
    ),
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        provideCodeActions(document, _range, context) {
          return provideDiagnosticSuppressionCodeActions(document, context);
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position) {
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return null;
        }
        return provideHover(
          document,
          position,
          b.languageData,
          b.schema,
          options.getSettings().maxDiagnosticsLines,
        );
      },
    }),
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      async provideDocumentFormattingEdits(document) {
        const settings = options.getSettings();
        if (!settings.formatEnabled) {
          return [];
        }
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return [];
        }
        const text = document.getText();
        const formatted = formatConfig(text, {
          ...getFormatOptions(settings),
          sectionHeaders: sectionHeaderSet(b.schema),
        });
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(text.length),
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
      },
    }),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(document) {
        return provideDocumentSymbols(document);
      },
    }),
    vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges(document) {
        return provideFoldingRanges(document);
      },
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position) {
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return null;
        }
        return provideDefinition(
          document,
          position,
          b.schema,
          options.getSettings().maxDiagnosticsLines,
        );
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      async provideReferences(document, position, refContext) {
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return [];
        }
        return provideReferences(
          document,
          position,
          refContext,
          b.schema,
          options.getSettings().maxDiagnosticsLines,
        );
      },
    }),
    vscode.languages.registerRenameProvider(selector, {
      async prepareRename(document, position) {
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return null;
        }
        return prepareRename(
          document,
          position,
          b.schema,
          options.getSettings().maxDiagnosticsLines,
        );
      },
      async provideRenameEdits(document, position, newName) {
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return null;
        }
        return provideRenameEdits(
          document,
          position,
          newName,
          b.schema,
          options.getSettings().maxDiagnosticsLines,
        );
      },
    }),
  );
}
