import { CompletionHandler } from "./types";
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
import { tryUseServiceCompletion } from "./handlers/useService";

/** Handlers are tried in order; first non-null result wins. */
export const COMPLETION_HANDLERS: CompletionHandler[] = [
  tryLogFormatCompletion,
  trySectionCompletion,
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
