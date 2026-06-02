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
const version_1 = require("./version");
function activate(context) {
    let bundle = loadBundle(context);
    const diagnostics = vscode.languages.createDiagnosticCollection("haproxy");
    context.subscriptions.push(diagnostics);
    const refreshDiagnostics = (document) => {
        if (document.languageId !== "haproxy") {
            return;
        }
        diagnostics.set(document.uri, (0, diagnostics_1.computeDiagnostics)(document, bundle.schema));
    };
    const refreshAllDocuments = () => {
        vscode.workspace.textDocuments.forEach(refreshDiagnostics);
    };
    const reloadBundle = async (fromConfigChange) => {
        const previous = bundle.version;
        bundle = loadBundle(context);
        refreshAllDocuments();
        if (fromConfigChange && previous !== bundle.version) {
            const grammarChanged = (0, grammar_1.syncActiveGrammar)(context, bundle.version);
            await (0, grammar_1.promptReloadIfGrammarChanged)(grammarChanged);
        }
    };
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refreshDiagnostics), vscode.workspace.onDidChangeTextDocument((event) => refreshDiagnostics(event.document)), vscode.workspace.onDidSaveTextDocument(refreshDiagnostics), vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)), (0, version_1.onVersionConfigurationChanged)(() => {
        (0, schema_1.clearSchemaCache)();
        (0, languageData_1.clearLanguageDataCache)();
        void reloadBundle(true);
    }));
    refreshAllDocuments();
    const selector = { language: "haproxy" };
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
        provideCompletionItems(document, position) {
            return (0, completion_1.provideCompletionItems)(document, position, bundle.languageData, bundle.schema);
        },
    }, " ", "\t"), vscode.languages.registerHoverProvider(selector, {
        provideHover(document, position) {
            return (0, hover_1.provideHover)(document, position, bundle.languageData, bundle.schema);
        },
    }));
}
function loadBundle(context) {
    const version = (0, version_1.getConfiguredVersion)();
    (0, grammar_1.syncActiveGrammar)(context, version);
    return {
        version,
        schema: (0, schema_1.loadSchema)(context, version),
        languageData: (0, languageData_1.loadLanguageData)(context, version),
    };
}
function deactivate() {
    // no-op
}
//# sourceMappingURL=extension.js.map