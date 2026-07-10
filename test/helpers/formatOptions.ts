import { DEFAULT_FORMAT_OPTIONS, FormatOptions } from "../../src/formatter";
import { sectionHeaderSet } from "../../src/schema/layout";

import { loadSchema, SupportedVersion } from "./schema";

export function formatOptionsWithSchema(version: SupportedVersion = "3.2"): FormatOptions {
  return {
    ...DEFAULT_FORMAT_OPTIONS,
    sectionHeaders: sectionHeaderSet(loadSchema(version)),
  };
}

export function parseOptionsWithSchema(version: SupportedVersion = "3.2") {
  return { sectionHeaders: sectionHeaderSet(loadSchema(version)) };
}
