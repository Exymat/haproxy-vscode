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
exports.DEFAULT_HAPROXY_VERSION = exports.SUPPORTED_HAPROXY_VERSIONS = void 0;
exports.getConfiguredVersion = getConfiguredVersion;
exports.setConfiguredVersion = setConfiguredVersion;
exports.onVersionConfigurationChanged = onVersionConfigurationChanged;
const vscode = __importStar(require("vscode"));
exports.SUPPORTED_HAPROXY_VERSIONS = ["3.0", "3.2", "3.4"];
exports.DEFAULT_HAPROXY_VERSION = "3.2";
const CONFIG_SECTION = "haproxy";
const CONFIG_VERSION = "version";
function isHaproxyVersion(raw) {
    return exports.SUPPORTED_HAPROXY_VERSIONS.includes(raw ?? "");
}
function getConfiguredVersion() {
    const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get(CONFIG_VERSION);
    if (isHaproxyVersion(raw)) {
        return raw;
    }
    return exports.DEFAULT_HAPROXY_VERSION;
}
async function setConfiguredVersion(version) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update(CONFIG_VERSION, version, target);
}
function onVersionConfigurationChanged(listener) {
    return vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_VERSION}`)) {
            listener(getConfiguredVersion());
        }
    });
}
//# sourceMappingURL=version.js.map