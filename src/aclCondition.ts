import { HaproxySchema, keywordGroupSet, sampleExpressionNameSets } from "./schema";
import { findClosingBrace, findExprEnd, readIdentifier, skipSpace } from "./expressionParsing";
import { ExpressionSpan, SampleDiagnostic, validateExpressionBody } from "./sampleExpression";

function isAclOnlyCriterion(
  name: string,
  aclCriteria: Set<string>,
  fetchNames: Set<string>,
  fetches: Record<string, import("./schema").SampleFunction>,
): boolean {
  const lower = name.toLowerCase();
  if (!aclCriteria.has(lower)) {
    return false;
  }
  if (fetchNames.has(lower) || fetches[name] || fetches[lower]) {
    return false;
  }
  return true;
}

export function extractAclConditionSpans(lineText: string): ExpressionSpan[] {
  const spans: ExpressionSpan[] = [];
  let idx = 0;
  while (idx < lineText.length) {
    const open = lineText.indexOf("{", idx);
    if (open < 0) {
      break;
    }
    if (open > 0 && lineText[open - 1] === "%") {
      idx = open + 1;
      continue;
    }
    const close = findClosingBrace(lineText, open);
    const start = open + 1;
    if (close < 0) {
      spans.push({ text: lineText.slice(start), start });
      break;
    }
    spans.push({ text: lineText.slice(start, close), start });
    idx = close + 1;
  }
  return spans;
}

/** Validate only sample-fetch subexpressions inside an ACL condition (not -m / eq / predefined ACLs). */
export function validateAclConditions(lineText: string, schema: HaproxySchema): SampleDiagnostic[] {
  const fetches = schema.sample_fetches ?? {};
  const converters = schema.sample_converters ?? {};
  const { fetchNames, convNames } = sampleExpressionNameSets(schema);
  const aclCriteria = keywordGroupSet(schema, "acl_criteria");

  const issues: SampleDiagnostic[] = [];
  for (const span of extractAclConditionSpans(lineText)) {
    const body = span.text;
    let pos = 0;
    while (pos < body.length) {
      pos = skipSpace(body, pos);
      if (pos >= body.length) {
        break;
      }
      if (body[pos] === "(") {
        const end = findExprEnd(body, pos);
        const slice = body.slice(pos, end);
        issues.push(
          ...validateExpressionBody(
            slice,
            span.start + pos,
            fetches,
            converters,
            fetchNames,
            convNames,
            schema,
          ),
        );
        pos = end;
        continue;
      }
      const idStart = skipSpace(body, pos);
      const id = readIdentifier(body, pos);
      if (!id.name) {
        pos += 1;
        continue;
      }
      const aclOnly = isAclOnlyCriterion(id.name, aclCriteria, fetchNames, fetches);
      const after = skipSpace(body, id.end);
      if (after < body.length && body[after] === "(") {
        const end = findExprEnd(body, after);
        if (aclOnly) {
          pos = end;
          continue;
        }
        const slice = body.slice(pos, end);
        issues.push(
          ...validateExpressionBody(
            slice,
            span.start + pos,
            fetches,
            converters,
            fetchNames,
            convNames,
            schema,
          ),
        );
        pos = end;
        continue;
      }
      const tail = skipSpace(body, id.end);
      if (tail >= body.length && fetchNames.has(id.name)) {
        issues.push(
          ...validateExpressionBody(
            id.name,
            span.start + idStart,
            fetches,
            converters,
            fetchNames,
            convNames,
            schema,
          ),
        );
      }
      pos = id.end;
    }
  }
  return issues;
}
