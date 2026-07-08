import { tryAclCriterionCompletion } from "./handlers/aclCriterion";
import { tryActionCompletion } from "./handlers/action";
import { tryDirectiveCompletion } from "./handlers/directive";
import { tryDirectiveArgumentCompletion } from "./handlers/directiveArgument";
import { tryExpressionCompletion } from "./handlers/expression";
import { tryFilterCompletion } from "./handlers/filter";
import { tryLineOptionCompletion } from "./handlers/lineOption";
import { tryLogFormatCompletion } from "./handlers/logFormat";
import { tryOptionCompletion } from "./handlers/option";
import { trySectionCompletion } from "./handlers/section";
import { trySymbolReferenceCompletion } from "./handlers/symbolReference";
import { tryUseServiceCompletion } from "./handlers/useService";
import { CompletionContext } from "./types";

export interface CompletionHandlerOptions {
  maxSymbolLines: number;
}

/** Handlers are tried in order; first non-null result wins. */
export function runCompletionHandlers(
  cc: CompletionContext,
  options: CompletionHandlerOptions,
): import("vscode").CompletionItem[] {
  const handlers: Array<(cc: CompletionContext) => import("vscode").CompletionItem[] | null> = [
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
    tryDirectiveArgumentCompletion,
    tryDirectiveCompletion,
  ];

  for (const handler of handlers) {
    const items = handler(cc);
    if (items !== null) {
      return items;
    }
  }

  return [];
}
