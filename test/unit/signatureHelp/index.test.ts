import { describe, expect, it } from "vitest";

import { provideSignatureHelp } from "../../../src/signatureHelp";
import { cursorAtLineEnd } from "../../helpers/cursor";
import { createDocument } from "../../helpers/document";
import { loadSchema, loadSchemaBundle } from "../../helpers/schema";

const schema = loadSchema("3.4");
const bundle = loadSchemaBundle("3.4");

describe("signatureHelp", () => {
  it("provides signature help from argument models", () => {
    const doc = createDocument("defaults\n    errorfile 400 ");
    const help = provideSignatureHelp(
      doc,
      cursorAtLineEnd("defaults\n    errorfile 400 ", 1),
      schema,
      bundle.languageData,
      4000,
    );
    expect(help?.signatures[0]?.label).toContain("errorfile");
    expect(help?.signatures[0]?.parameters.length).toBeGreaterThan(0);
  });

  it("returns null for oversized documents and unmatched lines", () => {
    const oversized = createDocument("defaults\n    errorfile 400 /tmp/a");
    expect(
      provideSignatureHelp(
        oversized,
        cursorAtLineEnd("defaults\n    errorfile 400 /tmp/a", 1),
        schema,
        bundle.languageData,
        1,
      ),
    ).toBeNull();

    const unmatched = createDocument("frontend web\n    ");
    expect(
      provideSignatureHelp(
        unmatched,
        cursorAtLineEnd("frontend web\n    ", 1),
        schema,
        bundle.languageData,
        4000,
      ),
    ).toBeNull();
  });

  it("returns null when signatures are empty and clamps active parameter", () => {
    const noSignaturesSchema = {
      ...schema,
      keywords: {
        ...schema.keywords,
        mode: {
          ...schema.keywords.mode,
          signatures: [],
          variants: (schema.keywords.mode.variants ?? []).map((variant) => ({
            ...variant,
            signatures: [],
          })),
        },
      },
    };
    const modeLang = bundle.languageData.keywords.mode;
    const noSignaturesData = {
      ...bundle.languageData,
      keywords: {
        ...bundle.languageData.keywords,
        mode: modeLang
          ? {
              ...modeLang,
              signatures: [],
              variants: (modeLang.variants ?? []).map((variant) => ({
                ...variant,
                signatures: [],
              })),
            }
          : modeLang,
      },
    };
    expect(
      provideSignatureHelp(
        createDocument("defaults\n    mode "),
        cursorAtLineEnd("defaults\n    mode ", 1),
        noSignaturesSchema,
        noSignaturesData,
        4000,
      ),
    ).toBeNull();

    const modeBase = schema.keywords.mode;
    expect(modeBase).toBeDefined();
    const schemaNoModel = {
      ...schema,
      keywords: {
        ...schema.keywords,
        mode: {
          ...modeBase,
          argument_model: undefined,
          variants: (modeBase.variants ?? []).map((variant) => ({
            ...variant,
            argument_model: undefined,
          })),
        },
      },
    };
    const modeHelp = provideSignatureHelp(
      createDocument("defaults\n    mode "),
      cursorAtLineEnd("defaults\n    mode ", 1),
      schemaNoModel,
      bundle.languageData,
      4000,
    );
    expect(modeHelp?.signatures.length).toBeGreaterThan(0);
    expect(modeHelp?.signatures[0]?.parameters ?? []).toEqual([]);

    const clampHelp = provideSignatureHelp(
      createDocument("defaults\n    errorfile 400 /tmp/a EXTRA"),
      cursorAtLineEnd("defaults\n    errorfile 400 /tmp/a EXTRA", 1),
      schema,
      bundle.languageData,
      4000,
    );
    expect(clampHelp?.activeParameter).toBe(1);
  });
});
