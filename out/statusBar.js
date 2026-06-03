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
exports.registerVersionStatusBar = registerVersionStatusBar;
const vscode = __importStar(require("vscode"));
const version_1 = require("./version");
const SELECT_VERSION_COMMAND = "haproxy.selectVersion";
function isHaproxyEditor(editor) {
    return editor?.document.languageId === "haproxy";
}
function registerVersionStatusBar(context) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.command = SELECT_VERSION_COMMAND;
    context.subscriptions.push(item);
    const refresh = () => {
        const version = (0, version_1.getConfiguredVersion)();
        item.text = `$(versions) HAProxy ${version}`;
        item.tooltip = "Click to change HAProxy version used for completion, diagnostics, and highlighting";
        if (isHaproxyEditor(vscode.window.activeTextEditor)) {
            item.show();
        }
        else {
            item.hide();
        }
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => refresh()), (0, version_1.onVersionConfigurationChanged)(() => refresh()));
    context.subscriptions.push(vscode.commands.registerCommand(SELECT_VERSION_COMMAND, async () => {
        const current = (0, version_1.getConfiguredVersion)();
        const picked = await vscode.window.showQuickPick([...version_1.SUPPORTED_HAPROXY_VERSIONS].map((version) => ({
            label: version,
            picked: version === current,
        })), {
            title: "HAProxy version",
            placeHolder: "Select HAProxy release for completion, diagnostics, and highlighting",
        });
        if (picked && picked.label !== current) {
            await (0, version_1.setConfiguredVersion)(picked.label);
        }
    }));
    refresh();
}
//# sourceMappingURL=statusBar.js.map