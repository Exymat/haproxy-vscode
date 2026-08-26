"use strict";

class Range {
  constructor(startLine, startChar, endLine, endChar) {
    this.start = { line: startLine, character: startChar };
    this.end = { line: endLine, character: endChar };
  }
}

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

const DiagnosticSeverity = { Warning: 1, Error: 0, Information: 2, Hint: 3 };
const DiagnosticTag = { Unnecessary: 1, Deprecated: 2 };
const workspace = {
  textDocuments: [],
  workspaceFolders: undefined,
  getWorkspaceFolder: () => undefined,
};

module.exports = { Range, Diagnostic, DiagnosticSeverity, DiagnosticTag, workspace };
