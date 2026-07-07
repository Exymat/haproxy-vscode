import { bench, describe } from "vitest";

import { buildWorkspaceSymbolIndexFromOpenDocuments } from "../../src/symbolIndex";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.2");

const splitDocs = Array.from({ length: 200 }, (_, i) => {
  const name = `api_${String(i).padStart(3, "0")}`;
  const content =
    i % 2 === 0
      ? `frontend web_${i}\n    use_backend ${name}`
      : `backend ${name}\n    server s1 127.0.0.1:80`;
  return createDocument(content, `file:///workspace/haproxy/${name}.cfg`);
});

describe("workspaceSymbolIndex", () => {
  bench("build workspace graph: 200 split cfg files", () => {
    buildWorkspaceSymbolIndexFromOpenDocuments(splitDocs, bundle.schema, 4000);
  });
});
