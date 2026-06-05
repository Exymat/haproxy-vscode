import { vi } from "vitest";

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export class Range {
  start: Position;
  end: Position;

  constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
    this.start = new Position(startLine, startChar);
    this.end = new Position(endLine, endChar);
  }
}

export class Diagnostic {
  source?: string;
  code?: string;

  constructor(
    public range: Range,
    public message: string,
    public severity?: number,
  ) {}
}

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

export class CompletionItem {
  detail?: string;
  documentation?: MarkdownString;

  constructor(
    public label: string,
    public kind?: number,
  ) {}
}

export const CompletionItemKind = {
  Value: 12,
  Keyword: 14,
  Module: 19,
  Function: 3,
};

export class Hover {
  constructor(
    public contents: unknown,
    public range?: Range,
  ) {}
}

export class MarkdownString {
  value = "";

  appendMarkdown(text: string): void {
    this.value += text;
  }
}

export class DocumentSymbol {
  constructor(
    public name: string,
    public detail: string,
    public kind: number,
    public range: Range,
    public selectionRange: Range,
  ) {}
}

export const SymbolKind = { Namespace: 1 };

export class FoldingRange {
  constructor(
    public start: number,
    public end: number,
    public kind?: number,
  ) {}
}

export const FoldingRangeKind = { Region: 1 };

export class Location {
  constructor(
    public uri: unknown,
    public range: Range,
  ) {}
}

export interface ReferenceContext {
  includeDeclaration: boolean;
}

export class TextEdit {
  static replace(range: Range, newText: string) {
    return { range, newText };
  }
}

export const StatusBarAlignment = { Right: 2 };

export class StatusBarItem {
  text = "";
  tooltip = "";
  command?: string;
  show = vi.fn();
  hide = vi.fn();
  dispose = vi.fn();
}

export const ConfigurationTarget = { Global: 1, Workspace: 2 };

const configValues = new Map<string, unknown>();
const configListeners: Array<
  (event: { affectsConfiguration: (section: string) => boolean }) => void
> = [];
const activeEditorListeners: Array<() => void> = [];

export let mockTextDocuments: Array<{
  uri: { toString: () => string };
  languageId: string;
  version: number;
  lineCount: number;
  lineAt: (line: number) => { text: string };
  getText: (range?: Range) => string;
  positionAt: (offset: number) => Position;
}> = [];

export let mockActiveTextEditor: { document: (typeof mockTextDocuments)[0] } | undefined;
export let mockWorkspaceFolders: Array<{ uri: { fsPath: string } }> | undefined;

export function resetVscodeMock(): void {
  configValues.clear();
  configListeners.length = 0;
  activeEditorListeners.length = 0;
  mockTextDocuments = [];
  mockActiveTextEditor = undefined;
  mockWorkspaceFolders = undefined;
  diagnosticCollections.length = 0;
  registeredCommands.clear();
  registeredDisposables.length = 0;
  lastQuickPickItems = undefined;
  lastQuickPickResult = undefined;
  lastInfoMessageResult = undefined;
}

export function setMockActiveTextEditor(editor: typeof mockActiveTextEditor): void {
  mockActiveTextEditor = editor;
}

export function setMockWorkspaceFolders(folders: typeof mockWorkspaceFolders): void {
  mockWorkspaceFolders = folders;
}

export function setMockQuickPickResult(result: typeof lastQuickPickResult): void {
  lastQuickPickResult = result;
}

export function setMockInfoMessageResult(result: typeof lastInfoMessageResult): void {
  lastInfoMessageResult = result;
}

export function setMockConfig(section: string, key: string, value: unknown): void {
  configValues.set(`${section}.${key}`, value);
}

export function triggerMockConfigurationChange(section = "haproxy"): void {
  for (const listener of configListeners) {
    listener({
      affectsConfiguration: (s: string) => s === section || section.startsWith(s),
    });
  }
}

export function triggerMockActiveEditorChange(): void {
  for (const listener of activeEditorListeners) {
    listener();
  }
}

export let lastQuickPickItems: unknown;
export let lastQuickPickResult: { label: string } | undefined;
export let lastInfoMessageResult: string | undefined;

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
const registeredDisposables: Array<{ dispose: () => void }> = [];
const diagnosticCollections: Array<{
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}> = [];

export function getRegisteredCommand(name: string) {
  return registeredCommands.get(name);
}

export function getLastDiagnosticCollection() {
  return diagnosticCollections[diagnosticCollections.length - 1];
}

export const workspace = {
  getConfiguration(section: string) {
    return {
      get<T>(key: string, defaultValue?: T): T {
        const value = configValues.get(`${section}.${key}`);
        return (value !== undefined ? value : defaultValue) as T;
      },
      async update(key: string, value: unknown, _target?: number) {
        configValues.set(`${section}.${key}`, value);
      },
    };
  },
  get textDocuments() {
    return mockTextDocuments;
  },
  get workspaceFolders() {
    return mockWorkspaceFolders;
  },
  onDidChangeConfiguration(
    listener: (event: { affectsConfiguration: (section: string) => boolean }) => void,
  ) {
    configListeners.push(listener);
    return { dispose: () => {} };
  },
  onDidOpenTextDocument(listener: (doc: (typeof mockTextDocuments)[0]) => void) {
    const disposable = {
      dispose: () => {},
    };
    for (const doc of mockTextDocuments) {
      listener(doc);
    }
    return disposable;
  },
  onDidChangeTextDocument(listener: (event: { document: (typeof mockTextDocuments)[0] }) => void) {
    return {
      dispose: () => {},
      trigger(doc: (typeof mockTextDocuments)[0]) {
        listener({ document: doc });
      },
    };
  },
  onDidSaveTextDocument(_listener: (doc: (typeof mockTextDocuments)[0]) => void) {
    return { dispose: () => {} };
  },
  onDidCloseTextDocument(_listener: (doc: (typeof mockTextDocuments)[0]) => void) {
    return { dispose: () => {} };
  },
};

export const window = {
  get activeTextEditor() {
    return mockActiveTextEditor;
  },
  createStatusBarItem(_alignment?: number, _priority?: number) {
    return new StatusBarItem();
  },
  onDidChangeActiveTextEditor(listener: () => void) {
    activeEditorListeners.push(listener);
    return { dispose: () => {} };
  },
  showInformationMessage(_message: string, ...actions: string[]) {
    return Promise.resolve(lastInfoMessageResult ?? actions[0]);
  },
  showQuickPick(items: Array<{ label: string; picked?: boolean }>, _options?: unknown) {
    lastQuickPickItems = items;
    return Promise.resolve(lastQuickPickResult);
  },
};

export const languages = {
  createDiagnosticCollection(_name: string) {
    const collection = {
      set: vi.fn(),
      delete: vi.fn(),
    };
    diagnosticCollections.push(collection);
    return collection;
  },
  registerCompletionItemProvider(_selector: unknown, provider: unknown, ..._triggers: string[]) {
    registeredDisposables.push({ dispose: () => {} });
    return { provider, dispose: () => {} };
  },
  registerHoverProvider(_selector: unknown, provider: unknown) {
    registeredDisposables.push({ dispose: () => {} });
    return { provider, dispose: () => {} };
  },
  registerDocumentFormattingEditProvider(_selector: unknown, provider: unknown) {
    registeredDisposables.push({ dispose: () => {} });
    return { provider, dispose: () => {} };
  },
  registerDocumentSymbolProvider(_selector: unknown, provider: unknown) {
    registeredDisposables.push({ dispose: () => {} });
    return { provider, dispose: () => {} };
  },
  registerFoldingRangeProvider(_selector: unknown, provider: unknown) {
    registeredDisposables.push({ dispose: () => {} });
    return { provider, dispose: () => {} };
  },
  registerDefinitionProvider(_selector: unknown, provider: unknown) {
    registeredDisposables.push({ dispose: () => {} });
    return { provider, dispose: () => {} };
  },
  registerReferenceProvider(_selector: unknown, provider: unknown) {
    registeredDisposables.push({ dispose: () => {} });
    return { provider, dispose: () => {} };
  },
};

export const commands = {
  registerCommand(name: string, handler: (...args: unknown[]) => unknown) {
    registeredCommands.set(name, handler);
    return { dispose: () => {} };
  },
  executeCommand: vi.fn(async () => undefined),
};

export function createMockExtensionContext(extensionPath: string) {
  return {
    extensionPath,
    subscriptions: registeredDisposables,
  };
}
