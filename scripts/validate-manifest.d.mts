export function extractNpmRunScriptNames(text: string): string[];

export function findMissingScriptReferences(
  scripts: Record<string, string>,
  source: string,
  text: string,
): string[];

export function collectMissingScriptReferences(
  scripts: Record<string, string>,
  options?: { workflowsDir?: string | null },
): string[];
