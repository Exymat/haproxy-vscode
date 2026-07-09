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

export class Selection extends Range {
  constructor(start: Position, end: Position) {
    super(start.line, start.character, end.line, end.character);
  }
}

export class Diagnostic {
  source?: string;
  code?: string;
  tags?: number[];

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

export const DiagnosticTag = {
  Unnecessary: 1,
  Deprecated: 2,
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
  isTrusted?: boolean | { enabledCommands: string[] };

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

export class LocationLink {
  constructor(
    public targetUri: unknown,
    public targetRange: Range,
    public targetSelectionRange?: Range,
    public originSelectionRange?: Range,
  ) {}
}

export class WorkspaceEdit {
  edits: Array<{ uri: unknown; range: Range; newText: string }> = [];

  get size(): number {
    return this.edits.length;
  }

  replace(uri: unknown, range: Range, newText: string): void {
    this.edits.push({ uri, range, newText });
  }
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

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

export class FileSystemError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = code;
    this.code = code;
  }

  static FileNotFound(
    messageOrUri: string | { fsPath?: string; toString: () => string },
  ): FileSystemError {
    const message =
      typeof messageOrUri === "string"
        ? messageOrUri
        : `EntryNotFound (FileSystemError): ${messageOrUri.fsPath ?? messageOrUri.toString()}`;
    return new FileSystemError(message, "FileNotFound");
  }

  static FilePermissionDenied(
    messageOrUri: string | { fsPath?: string; toString: () => string },
  ): FileSystemError {
    const message =
      typeof messageOrUri === "string"
        ? messageOrUri
        : `NoPermissions (FileSystemError): ${messageOrUri.fsPath ?? messageOrUri.toString()}`;
    return new FileSystemError(message, "FilePermissionDenied");
  }
}

export class RelativePattern {
  baseUri: { fsPath?: string; toString: () => string };

  constructor(
    base: {
      uri?: { fsPath?: string; toString: () => string };
      fsPath?: string;
      toString?: () => string;
    },
    public pattern: string,
  ) {
    this.baseUri =
      "uri" in base && base.uri
        ? base.uri
        : { fsPath: base.fsPath, toString: () => base.toString?.() ?? base.fsPath ?? "" };
  }
}

const configValues = new Map<string, unknown>();
const configListeners: Array<
  (event: { affectsConfiguration: (section: string) => boolean }) => void
> = [];
const workspaceFolderChangeListeners: Array<
  (event: {
    added: NonNullable<typeof mockWorkspaceFolders>;
    removed: NonNullable<typeof mockWorkspaceFolders>;
  }) => void
> = [];
const activeEditorListeners: Array<() => void> = [];
const mockWorkspaceFiles = new Map<string, string>();
const mockWorkspaceFileStats = new Map<string, { mtime: number; size: number }>();
const mockWorkspaceReadFailures = new Set<string>();

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
export let mockWorkspaceFolders:
  Array<{ uri: { fsPath?: string; toString: () => string } }> | undefined;

export function resetVscodeMock(): void {
  configValues.clear();
  mockWorkspaceFiles.clear();
  mockWorkspaceFileStats.clear();
  mockWorkspaceReadFailures.clear();
  configListeners.length = 0;
  workspaceFolderChangeListeners.length = 0;
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
  window.showErrorMessage.mockClear();
  window.showWarningMessage.mockClear();
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

export function setMockConfigForUri(
  resource: { toString: () => string },
  section: string,
  key: string,
  value: unknown,
): void {
  configValues.set(`${uriKey(resource)}::${section}.${key}`, value);
}

function readMockConfig<T>(
  section: string,
  key: string,
  resource: { toString: () => string } | undefined,
  defaultValue?: T,
): T {
  if (resource) {
    const scoped = configValues.get(`${uriKey(resource)}::${section}.${key}`);
    if (scoped !== undefined) {
      return scoped as T;
    }
  }
  const value = configValues.get(`${section}.${key}`);
  return (value !== undefined ? value : defaultValue) as T;
}

export function setMockWorkspaceFile(path: string, content: string): void {
  mockWorkspaceFiles.set(path, content);
  mockWorkspaceFileStats.set(path, { mtime: Date.now(), size: content.length });
}

export function removeMockWorkspaceFile(path: string): void {
  mockWorkspaceFiles.delete(path);
  mockWorkspaceFileStats.delete(path);
  mockWorkspaceReadFailures.delete(path);
}

export function setMockWorkspaceFileStat(path: string, mtime: number, size: number): void {
  mockWorkspaceFileStats.set(path, { mtime, size });
}

export function setMockWorkspaceReadFailure(path: string, failing: boolean): void {
  if (failing) {
    mockWorkspaceReadFailures.add(path);
  } else {
    mockWorkspaceReadFailures.delete(path);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globPatternToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let source = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === "*") {
      const next = normalized[i + 1];
      if (next === "*") {
        const after = normalized[i + 2];
        if (after === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
        continue;
      }
      source += "[^/]*";
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(ch);
  }
  return new RegExp(`^${source}$`, "i");
}

function expandBracePattern(pattern: string): string[] {
  if (!pattern.startsWith("{") || !pattern.endsWith("}")) {
    return [pattern];
  }
  return pattern.slice(1, -1).split(",");
}

function globMatches(pattern: string | undefined, value: string): boolean {
  if (!pattern) {
    return true;
  }
  const normalized = value.replace(/\\/g, "/");
  return expandBracePattern(pattern).some((part) => globPatternToRegExp(part).test(normalized));
}

function uriKey(value: { toString: () => string }): string {
  return value.toString().toLowerCase().replace(/\/+$/, "");
}

function relativePatternParts(pattern: string | RelativePattern): {
  base?: string;
  pattern: string;
} {
  if (pattern instanceof RelativePattern) {
    return { base: uriKey(pattern.baseUri), pattern: pattern.pattern };
  }
  return { pattern };
}

function relativePath(base: string | undefined, path: string): string | null {
  if (!base) {
    return path;
  }
  const normalized = path.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  if (lower === base) {
    return "";
  }
  if (!lower.startsWith(`${base}/`)) {
    return null;
  }
  return normalized.slice(base.length + 1);
}

export function triggerMockConfigurationChange(section = "haproxy"): void {
  for (const listener of configListeners) {
    listener({
      affectsConfiguration: (s: string) => s === section || section.startsWith(s),
    });
  }
}

export function triggerMockWorkspaceFoldersChange(
  added: NonNullable<typeof mockWorkspaceFolders> = [],
  removed: NonNullable<typeof mockWorkspaceFolders> = [],
): void {
  for (const listener of workspaceFolderChangeListeners) {
    listener({ added, removed });
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
  getConfiguration(section: string, resource?: { toString: () => string }) {
    return {
      get<T>(key: string, defaultValue?: T): T {
        return readMockConfig(section, key, resource, defaultValue);
      },
      update(key: string, value: unknown, _target?: number) {
        if (resource) {
          configValues.set(`${uriKey(resource)}::${section}.${key}`, value);
          return;
        }
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
  findFiles(
    include: string | RelativePattern,
    exclude?: string | RelativePattern,
    maxResults?: number,
  ) {
    const includeParts = relativePatternParts(include);
    const excludeParts = exclude ? relativePatternParts(exclude) : undefined;
    const uris = [...mockWorkspaceFiles.keys()]
      .filter((path) => path.endsWith(".cfg"))
      .filter((path) => {
        const rel = relativePath(includeParts.base, path);
        return rel !== null && globMatches(includeParts.pattern, rel);
      })
      .filter((path) => {
        if (!excludeParts) {
          return true;
        }
        const rel = relativePath(excludeParts.base, path);
        return rel === null || !globMatches(excludeParts.pattern, rel);
      })
      .slice(0, maxResults)
      .map((path) => Uri.file(path));
    return Promise.resolve(uris);
  },
  getWorkspaceFolder(uri: { toString: () => string }) {
    const key = uriKey(uri);
    return mockWorkspaceFolders?.find((folder) => {
      const folderKey = uriKey(folder.uri);
      return key === folderKey || key.startsWith(`${folderKey}/`);
    });
  },
  fs: {
    stat(uri: { fsPath?: string; toString: () => string }) {
      const key = uri.fsPath ?? uri.toString();
      const stat = mockWorkspaceFileStats.get(key);
      if (!stat) {
        return Promise.reject(FileSystemError.FileNotFound(uri));
      }
      return Promise.resolve({ mtime: stat.mtime, size: stat.size });
    },
    readFile(uri: { fsPath?: string; toString: () => string }) {
      const key = uri.fsPath ?? uri.toString();
      if (mockWorkspaceReadFailures.has(key)) {
        return Promise.reject(FileSystemError.FilePermissionDenied(uri));
      }
      const content = mockWorkspaceFiles.get(key) ?? "";
      return Promise.resolve(new TextEncoder().encode(content));
    },
  },
  openTextDocument(_uri: unknown) {
    return Promise.resolve(mockTextDocuments[0]);
  },
  createFileSystemWatcher(_globPattern: unknown) {
    const listeners = {
      create: [] as Array<(uri: { fsPath?: string; toString: () => string }) => void>,
      change: [] as Array<(uri: { fsPath?: string; toString: () => string }) => void>,
      delete: [] as Array<(uri: { fsPath?: string; toString: () => string }) => void>,
    };
    return {
      onDidCreate(listener: (uri: { fsPath?: string; toString: () => string }) => void) {
        listeners.create.push(listener);
        return { dispose: () => {} };
      },
      onDidChange(listener: (uri: { fsPath?: string; toString: () => string }) => void) {
        listeners.change.push(listener);
        return { dispose: () => {} };
      },
      onDidDelete(listener: (uri: { fsPath?: string; toString: () => string }) => void) {
        listeners.delete.push(listener);
        return { dispose: () => {} };
      },
      dispose: vi.fn(),
      triggerCreate(
        uri: { fsPath?: string; toString: () => string } = Uri.file("file:///test.cfg"),
      ) {
        for (const listener of listeners.create) {
          listener(uri);
        }
      },
      triggerChange(
        uri: { fsPath?: string; toString: () => string } = Uri.file("file:///test.cfg"),
      ) {
        for (const listener of listeners.change) {
          listener(uri);
        }
      },
      triggerDelete(
        uri: { fsPath?: string; toString: () => string } = Uri.file("file:///test.cfg"),
      ) {
        for (const listener of listeners.delete) {
          listener(uri);
        }
      },
    };
  },
  onDidChangeConfiguration(
    listener: (event: { affectsConfiguration: (section: string) => boolean }) => void,
  ) {
    configListeners.push(listener);
    return { dispose: () => {} };
  },
  onDidChangeWorkspaceFolders(
    listener: (event: {
      added: NonNullable<typeof mockWorkspaceFolders>;
      removed: NonNullable<typeof mockWorkspaceFolders>;
    }) => void,
  ) {
    workspaceFolderChangeListeners.push(listener);
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
  showTextDocument(document: (typeof mockTextDocuments)[0], _options?: unknown) {
    return Promise.resolve({ document, selection: undefined });
  },
  onDidChangeActiveTextEditor(listener: () => void) {
    activeEditorListeners.push(listener);
    return { dispose: () => {} };
  },
  showInformationMessage(_message: string, ...actions: string[]) {
    return Promise.resolve(lastInfoMessageResult ?? actions[0]);
  },
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  showQuickPick(items: Array<{ label: string; picked?: boolean }>, _options?: unknown) {
    lastQuickPickItems = items;
    return Promise.resolve(lastQuickPickResult);
  },
};

export const languages = {
  setTextDocumentLanguage: vi.fn(
    (document: { languageId: string }, languageId: string): Promise<void> => {
      Object.defineProperty(document, "languageId", {
        value: languageId,
        writable: true,
        configurable: true,
      });
      return Promise.resolve();
    },
  ),
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
  registerRenameProvider(_selector: unknown, provider: unknown) {
    registeredDisposables.push({ dispose: () => {} });
    return { provider, dispose: () => {} };
  },
};

export const commands = {
  registerCommand(name: string, handler: (...args: unknown[]) => unknown) {
    registeredCommands.set(name, handler);
    return { dispose: () => {} };
  },
  executeCommand: vi.fn(() => Promise.resolve(undefined)),
};

export const Uri = {
  parse(value: string) {
    return { toString: () => value, fsPath: value };
  },
  file(value: string) {
    return { toString: () => value, fsPath: value };
  },
};

export function createMockExtensionContext(extensionPath: string) {
  return {
    extensionPath,
    subscriptions: registeredDisposables,
  };
}
