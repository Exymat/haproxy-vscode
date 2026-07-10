import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema/types";
import { candidateRules, ruleMatchesLine } from "./statementLayout";

/** True when the line is `option …` or `no option …`. */
export function isOptionLine(line: ParsedLine, schema?: HaproxySchema): boolean {
  if (schema) {
    for (const rule of candidateRules(schema, line)) {
      if (rule.kind === "option" && ruleMatchesLine(rule, line.tokens)) {
        return true;
      }
    }
    return false;
  }
  const t0 = line.tokens[0]?.text.toLowerCase();
  const t1 = line.tokens[1]?.text.toLowerCase();
  return t0 === "option" || (t0 === "no" && t1 === "option");
}

/** Token index of the option name on an option line, or -1 when not an option line. */
export function optionNameTokenIndex(line: ParsedLine, schema?: HaproxySchema): number {
  if (!isOptionLine(line, schema)) {
    return -1;
  }
  const t0 = line.tokens[0]?.text.toLowerCase();
  return t0 === "option" ? 1 : 2;
}
