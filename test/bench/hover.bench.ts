import { bench, describe } from "vitest";

import { getParsedDocument } from "../../src/parser/parseCache";
import { provideHover } from "../../src/hover";
import { loadSchemaBundle } from "../helpers/schema";
import { createDocument } from "../helpers/document";
import { Position } from "../__mocks__/vscode";

const bundle = loadSchemaBundle("3.2");

interface HoverCase {
  name: string;
  content: string;
  line: number;
  character: number;
}

const inlineConditionLine = "    http-request set-header Host unless { req.hdr(Host) -m found }";

const hoverCases: HoverCase[] = [
  {
    name: "directive (balance)",
    content: "defaults\n    balance roundrobin",
    line: 1,
    character: 6,
  },
  {
    name: "option (httplog)",
    content: "defaults\n    option httplog",
    line: 1,
    character: 11,
  },
  {
    name: "action (deny)",
    content: "frontend web\n    http-request deny",
    line: 1,
    character: "    http-request deny".indexOf("deny"),
  },
  {
    name: "expression (req.hdr)",
    content: "frontend web\n    http-request set-header X-Test %[req.hdr(host)]",
    line: 1,
    character: "    http-request set-header X-Test %[req.hdr(host)]".indexOf("req.hdr") + 2,
  },
  {
    name: "log-format alias (ci)",
    content: 'defaults\n    log-format "%{+Q}o %ci"',
    line: 1,
    character: '    log-format "%{+Q}o %ci"'.indexOf("ci") + 1,
  },
  {
    name: "log-format flag (Q)",
    content: 'defaults\n    log-format "%{+Q}"',
    line: 1,
    character: '    log-format "%{+Q}"'.indexOf("Q"),
  },
  {
    name: "inline condition fetch (req.hdr)",
    content: `frontend web\n${inlineConditionLine}`,
    line: 1,
    character: inlineConditionLine.indexOf("req.hdr") + 2,
  },
  {
    name: "inline condition ACL match (found)",
    content: `frontend web\n${inlineConditionLine}`,
    line: 1,
    character: inlineConditionLine.indexOf("found") + 1,
  },
];

function runHover(testCase: HoverCase, doc: ReturnType<typeof createDocument>): void {
  provideHover(
    doc,
    new Position(testCase.line, testCase.character) as never,
    bundle.languageData,
    bundle.schema,
  );
}

function runHoverMany(
  testCase: HoverCase,
  doc: ReturnType<typeof createDocument>,
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    runHover(testCase, doc);
  }
}

const warmHoverBatchSize = 100;

describe("hover", () => {
  const warmDocs = new Map<string, ReturnType<typeof createDocument>>();

  function warmDoc(testCase: HoverCase): ReturnType<typeof createDocument> {
    let doc = warmDocs.get(testCase.name);
    if (!doc) {
      doc = createDocument(testCase.content);
      getParsedDocument(doc);
      warmDocs.set(testCase.name, doc);
    }
    return doc;
  }

  for (const testCase of hoverCases) {
    bench(`hover cold: ${testCase.name}`, () => {
      const doc = createDocument(testCase.content);
      runHover(testCase, doc);
    });

    bench(
      `hover warm: ${testCase.name}`,
      () => {
        runHoverMany(testCase, warmDoc(testCase), warmHoverBatchSize);
      },
      { time: 1000, warmupIterations: 3 },
    );
  }
});
