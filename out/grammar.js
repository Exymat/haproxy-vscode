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
exports.grammarPathForVersion = grammarPathForVersion;
exports.activeGrammarPath = activeGrammarPath;
exports.syncActiveGrammar = syncActiveGrammar;
exports.promptReloadIfGrammarChanged = promptReloadIfGrammarChanged;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const ACTIVE_GRAMMAR = "haproxy-active.tmLanguage.json";
function grammarPathForVersion(extensionPath, version) {
    return path.join(extensionPath, "syntaxes", `haproxy-${version}.tmLanguage.json`);
}
function activeGrammarPath(extensionPath) {
    return path.join(extensionPath, "syntaxes", ACTIVE_GRAMMAR);
}
/** Copy version-specific grammar to the path referenced by package.json. Returns true if the file changed. */
function syncActiveGrammar(context, version) {
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
async function promptReloadIfGrammarChanged(changed) {
    if (!changed) {
        return;
    }
    const choice = await vscode.window.showInformationMessage("HAProxy version changed; reload the window to refresh syntax highlighting.", "Reload Window");
    if (choice === "Reload Window") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}
//# sourceMappingURL=grammar.js.map