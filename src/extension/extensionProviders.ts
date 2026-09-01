/** Registers VS Code language feature providers for HAProxy documents. */
import * as vscode from "vscode";

import { provideCompletionItems } from "../completion";
import { provideDiagnosticSuppressionCodeActions } from "../diagnostics/diagnosticCodeActions";
import { provideMissingBackendStubCodeActions } from "../diagnostics/missingBackendCodeAction";
import { provideDocumentHighlights } from "../navigation/documentHighlights";
import { provideDocumentSymbols } from "../navigation/documentSymbols";
import { ExtensionBundle } from "./extensionBundle";
import { formatConfig, formatConfigRange } from "../formatting";
import { haproxyDocumentSelector } from "./grammar";
import { provideHover } from "../hover";
import { provideDefinition, provideReferences } from "../navigation";
import { prepareRename, provideRenameEdits } from "../navigation/rename";
import { getFormatOptions, HaproxyExtensionSettings } from "./settings";
import { sectionHeaderSet } from "../schema/layout";
import { getWorkspaceSymbolIndex, workspaceUriKey } from "../symbolIndex";
import { provideFoldingRanges } from "../navigation/folding";
import { backendReferenceLegend, provideSemanticTokens } from "../navigation/semanticTokens";
import { provideWorkspaceSymbols } from "../navigation/workspaceSymbols";
import { provideSignatureHelp } from "../signatureHelp";

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
            options.getSettings().maxSymbolLines,
          );
        },
      },
      " ",
      "\t",
      ":",
      "/",
      ".",
      "(",
    ),
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        provideCodeActions(document, _range, context) {
          return [
            ...provideMissingBackendStubCodeActions(document, context),
            ...provideDiagnosticSuppressionCodeActions(document, context),
          ];
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
          options.getSettings().maxSymbolLines,
        );
      },
    }),
    vscode.languages.registerSignatureHelpProvider(
      selector,
      {
        async provideSignatureHelp(document, position) {
          const b = await options.safeEnsureBundle(document.uri);
          if (!b) {
            return null;
          }
          return provideSignatureHelp(
            document,
            position,
            b.schema,
            b.languageData,
            options.getSettings().maxDiagnosticsLines,
          );
        },
      },
      " ",
      ",",
    ),
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
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, {
      async provideDocumentRangeFormattingEdits(document, range) {
        const settings = options.getSettings();
        if (!settings.formatEnabled) {
          return [];
        }
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return [];
        }
        const formatOptions = {
          ...getFormatOptions(settings),
          sectionHeaders: sectionHeaderSet(b.schema),
        };
        const endLine =
          range.end.character === 0 && range.end.line > range.start.line
            ? range.end.line - 1
            : range.end.line;
        const formatted = formatConfigRange(
          document.getText(),
          { startLine: range.start.line, endLine },
          formatOptions,
        );
        const startPos = new vscode.Position(range.start.line, 0);
        const endPos = document.lineAt(endLine).range.end;
        return [vscode.TextEdit.replace(new vscode.Range(startPos, endPos), formatted)];
      },
    }),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      async provideDocumentSymbols(document) {
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return [];
        }
        return provideDocumentSymbols(document, b.schema);
      },
    }),
    vscode.languages.registerFoldingRangeProvider(selector, {
      async provideFoldingRanges(document) {
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return [];
        }
        return provideFoldingRanges(document, b.schema);
      },
    }),
    vscode.languages.registerDocumentHighlightProvider(selector, {
      async provideDocumentHighlights(document, position) {
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return [];
        }
        return provideDocumentHighlights(
          document,
          position,
          b.schema,
          options.getSettings().maxSymbolLines,
        );
      },
    }),
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      {
        async provideDocumentSemanticTokens(document) {
          const b = await options.safeEnsureBundle(document.uri);
          if (!b) {
            return new vscode.SemanticTokens(new Uint32Array(0));
          }
          return provideSemanticTokens(document, b.schema, options.getSettings().maxSymbolLines);
        },
      },
      backendReferenceLegend,
    ),
    vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols(query) {
        if (!options.getSettings().workspaceSymbolsEnabled) {
          return [];
        }
        return provideWorkspaceSymbols(query);
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
          options.getSettings().maxSymbolLines,
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
          options.getSettings().maxSymbolLines,
        );
      },
    }),
    vscode.languages.registerRenameProvider(selector, {
      async prepareRename(document, position) {
        const b = await options.safeEnsureBundle(document.uri);
        if (!b) {
          return null;
        }
        return prepareRename(document, position, b.schema, options.getSettings().maxSymbolLines);
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
          options.getSettings().maxSymbolLines,
        );
      },
    }),
  );
}
