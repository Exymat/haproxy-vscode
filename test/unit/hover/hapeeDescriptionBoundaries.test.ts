import { describe, expect, it } from "vitest";

import { provideHover } from "../../../src/hover";
import { createDocument } from "../../helpers/document";
import { HAPEE_SCHEMA_VERSIONS, loadHapeeBundle } from "../../helpers/schema";
import { hoverText } from "./helpers";

describe("Enterprise description boundaries", () => {
  it.each(HAPEE_SCHEMA_VERSIONS)(
    "keeps %s keyword and sample descriptions free of HTML menus",
    (version) => {
      const { languageData } = loadHapeeBundle(version);
      const serialized = JSON.stringify(languageData);
      expect(serialized).not.toContain("This keyword is available in sections");
      expect(serialized).not.toContain("Usable in : QUIC Ini");
      expect(
        languageData.groups.http_request_actions.find((item) => item.name === "del-header")
          ?.description,
      ).not.toContain("del-map(");
    },
  );

  it.each(HAPEE_SCHEMA_VERSIONS)(
    "renders %s action hover without the following keyword's description",
    (version) => {
      const { schema, languageData } = loadHapeeBundle(version);
      for (const [line, token, forbidden] of [
        ["    tcp-request connection accept", "accept", "add-acl("],
        ["    http-request del-header X-Custom", "del-header", "del-map("],
      ]) {
        const document = createDocument(`frontend web\n${line}`);
        const position = { line: 1, character: line.indexOf(token) + 2 };
        const hover = provideHover(document, position as never, languageData, schema);
        expect(hover).not.toBeNull();
        if (!hover) {
          throw new Error(`Missing ${version} ${token} hover`);
        }
        const text = hoverText(hover);
        expect(text).toContain(token);
        expect(text).not.toContain(forbidden);
        expect(text).not.toContain("This keyword is available in sections");
        expect(text).not.toContain("Usable in :");
      }
    },
  );
});
