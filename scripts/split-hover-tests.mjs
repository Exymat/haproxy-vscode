import fs from "node:fs";

const src = fs.readFileSync("test/unit/hover.test.ts", "utf8");
const lines = src.split(/\r?\n/);

const helperLines = lines
  .slice(0, 123)
  .map((line) =>
    line
      .replace(/\.\.\/\.\.\/src\//g, "../../../src/")
      .replace(/\.\.\/helpers\//g, "../../helpers/"),
  );
const provideLines = lines.slice(123, 1436);
const handlerLines = lines.slice(1436, 1660);

const helpers = `${helperLines.join("\n")}

export {
  bundles,
  hoverMarkdown,
  hoverText,
  optionHoverContext,
  actionHoverContext,
  logFormatHoverContext,
};
`;

const provide = `import { afterEach, describe, expect, it, vi } from "vitest";

import { formatHoverText, provideHover } from "../../../src/hover";
import { addSectionExtra } from "../../../src/hover/markdown";
import * as documentContext from "../../../src/documentContext";
import { bundles, hoverMarkdown, hoverText } from "./helpers";

${provideLines.join("\n")}
});

`;

const handlers = `import { afterEach, describe, expect, it, vi } from "vitest";

import * as directiveUtils from "../../../src/directiveUtils";
import { tryActionHover } from "../../../src/hover/handlers/actionHover";
import { tryLogFormatHover } from "../../../src/hover/handlers/logFormatHover";
import { tryOptionHover } from "../../../src/hover/handlers/optionHover";
import * as hoverHelpers from "../../../src/hover/helpers";
import {
  actionHoverContext,
  hoverText,
  logFormatHoverContext,
  optionHoverContext,
} from "./helpers";

${handlerLines.join("\n")}

`;

fs.mkdirSync("test/unit/hover", { recursive: true });
fs.writeFileSync("test/unit/hover/helpers.ts", helpers);
fs.writeFileSync("test/unit/hover/provideHover.test.ts", provide);
fs.writeFileSync("test/unit/hover/handlers.test.ts", handlers);
fs.unlinkSync("test/unit/hover.test.ts");
