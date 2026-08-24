/** Highlights all references to the HAProxy symbol at the cursor. */
import * as vscode from "vscode";

import { HaproxySchema } from "../schema/types";
import { provideDefinition, provideReferences } from "./index";

function rangeKey(uri: vscode.Uri, range: vscode.Range): string {
  return `${uri.toString()}\0${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
}

function definitionRangeKeys(definition: ReturnType<typeof provideDefinition>): Set<string> {
  const keys = new Set<string>();
  if (!definition) {
    return keys;
  }
  for (const target of Array.isArray(definition) ? definition : [definition]) {
    if ("targetUri" in target) {
      keys.add(rangeKey(target.targetUri, target.targetSelectionRange ?? target.targetRange));
    } else {
      keys.add(rangeKey(target.uri, target.range));
    }
  }
  return keys;
}

export function provideDocumentHighlights(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  maxLines: number,
): vscode.DocumentHighlight[] {
  const locations = provideReferences(
    document,
    position,
    { includeDeclaration: true },
    schema,
    maxLines,
  );
  if (locations.length === 0) {
    return [];
  }
  const definitions = definitionRangeKeys(provideDefinition(document, position, schema, maxLines));

  return locations
    .filter((location) => location.uri.toString() === document.uri.toString())
    .map(
      (location) =>
        new vscode.DocumentHighlight(
          location.range,
          definitions.has(rangeKey(location.uri, location.range))
            ? vscode.DocumentHighlightKind.Write
            : vscode.DocumentHighlightKind.Read,
        ),
    );
}
