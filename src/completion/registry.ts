/** Runs ordered completion handlers until the first one returns items. */
import { tryAclCriterionCompletion } from "./handlers/aclCriterion";
import { tryActionCompletion } from "./handlers/action";
import { tryDirectiveCompletion } from "./handlers/directive";
import { tryDirectiveArgumentCompletion } from "./handlers/directiveArgument";
import { tryExpressionCompletion } from "./handlers/expression";
import { tryFilterCompletion } from "./handlers/filter";
import { tryLineOptionCompletion } from "./handlers/lineOption";
import { tryLogFormatCompletion } from "./handlers/logFormat";
import { tryOptionCompletion } from "./handlers/option";
import { clearPathCompletionCache, tryPathCompletion } from "./handlers/pathCompletion";
import { trySectionCompletion } from "./handlers/section";
import { trySymbolReferenceCompletion } from "./handlers/symbolReference";
import { tryUseServiceCompletion } from "./handlers/useService";
import { CompletionContext } from "./types";

export interface CompletionHandlerOptions {
  maxSymbolLines: number;
}

type CompletionHandlerResult =
  import("vscode").CompletionItem[] | null | Promise<import("vscode").CompletionItem[] | null>;

/** Handlers are tried in order; first non-null result wins. */
export async function runCompletionHandlers(
  cc: CompletionContext,
  options: CompletionHandlerOptions,
): Promise<import("vscode").CompletionItem[]> {
  const handlers: Array<(cc: CompletionContext) => CompletionHandlerResult> = [
    tryLogFormatCompletion,
    trySectionCompletion,
    (context) => trySymbolReferenceCompletion(context, options.maxSymbolLines),
    tryOptionCompletion,
    tryLineOptionCompletion,
    tryUseServiceCompletion,
    tryActionCompletion,
    tryFilterCompletion,
    tryExpressionCompletion,
    tryAclCriterionCompletion,
    tryPathCompletion,
    tryDirectiveArgumentCompletion,
    tryDirectiveCompletion,
  ];

  for (const handler of handlers) {
    const items = await handler(cc);
    if (items !== null) {
      return items;
    }
  }

  return [];
}

export function clearCompletionHandlerCache(): void {
  clearPathCompletionCache();
}
