"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const completion_1 = require("./completion");
const diagnostics_1 = require("./diagnostics");
const grammar_1 = require("./grammar");
const hover_1 = require("./hover");
const languageData_1 = require("./languageData");
const schema_1 = require("./schema");
const settings_1 = require("./settings");
const statusBar_1 = require("./statusBar");
const version_1 = require("./version");
const pendingDiagnostics = new Map();
let bundle;
let bundleLoadPromise;
function activate(context) {
    (0, statusBar_1.registerVersionStatusBar)(context);
    const diagnostics = vscode.languages.createDiagnosticCollection("haproxy");
    context.subscriptions.push(diagnostics);
    const ensureBundle = () => {
        if (bundle) {
            return Promise.resolve(bundle);
        }
        if (!bundleLoadPromise) {
            bundleLoadPromise = new Promise((resolve) => {
                setImmediate(() => {
                    const version = (0, version_1.getConfiguredVersion)();
                    bundle = {
                        version,
                        schema: (0, schema_1.loadSchema)(context, version),
                        languageData: (0, languageData_1.loadLanguageData)(context, version),
                    };
                    resolve(bundle);
                });
            });
        }
        return bundleLoadPromise;
    };
    const runDiagnostics = async (document) => {
        const settings = (0, settings_1.getExtensionSettings)();
        if (!settings.diagnosticsEnabled || document.languageId !== "haproxy") {
            return;
        }
        if (document.lineCount > settings.maxDiagnosticsLines) {
            diagnostics.set(document.uri, []);
            return;
        }
        const b = await ensureBundle();
        diagnostics.set(document.uri, (0, diagnostics_1.computeDiagnostics)(document, b.schema));
    };
    const scheduleDiagnostics = (document) => {
        if (document.languageId !== "haproxy") {
            return;
        }
        const settings = (0, settings_1.getExtensionSettings)();
        if (!settings.diagnosticsEnabled) {
            diagnostics.delete(document.uri);
            return;
        }
        const key = document.uri.toString();
        const existing = pendingDiagnostics.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        pendingDiagnostics.set(key, setTimeout(() => {
            pendingDiagnostics.delete(key);
            void runDiagnostics(document);
        }, settings.diagnosticsDebounceMs));
    };
    const refreshAllDocuments = () => {
        for (const document of vscode.workspace.textDocuments) {
            scheduleDiagnostics(document);
        }
    };
    const reloadBundle = async (syncGrammar) => {
        (0, schema_1.clearSchemaCache)();
        (0, languageData_1.clearLanguageDataCache)();
        bundle = undefined;
        bundleLoadPromise = undefined;
        const b = await ensureBundle();
        if (syncGrammar) {
            const grammarChanged = (0, grammar_1.syncActiveGrammar)(context, b.version);
            await (0, grammar_1.promptReloadIfGrammarChanged)(grammarChanged);
        }
        refreshAllDocuments();
    };
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(scheduleDiagnostics), vscode.workspace.onDidChangeTextDocument((event) => scheduleDiagnostics(event.document)), vscode.workspace.onDidSaveTextDocument(scheduleDiagnostics), vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        const pending = pendingDiagnostics.get(key);
        if (pending) {
            clearTimeout(pending);
            pendingDiagnostics.delete(key);
        }
        diagnostics.delete(doc.uri);
    }), (0, version_1.onVersionConfigurationChanged)(() => {
        void reloadBundle(true);
    }), (0, settings_1.onSettingsChanged)(() => {
        refreshAllDocuments();
    }));
    setImmediate(() => {
        void ensureBundle().then((b) => {
            const grammarChanged = (0, grammar_1.syncActiveGrammar)(context, b.version);
            void (0, grammar_1.promptReloadIfGrammarChanged)(grammarChanged);
        });
        refreshAllDocuments();
    });
    const selector = { language: "haproxy" };
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
        async provideCompletionItems(document, position) {
            const b = await ensureBundle();
            return (0, completion_1.provideCompletionItems)(document, position, b.languageData, b.schema);
        },
    }, " ", "\t"), vscode.languages.registerHoverProvider(selector, {
        async provideHover(document, position) {
            const b = await ensureBundle();
            return (0, hover_1.provideHover)(document, position, b.languageData, b.schema);
        },
    }));
}
function deactivate() {
    bundle = undefined;
    bundleLoadPromise = undefined;
}
//# sourceMappingURL=extension.js.map