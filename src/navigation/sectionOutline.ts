/** Re-exports section outline helpers from the parser layer. */
export {
  buildSectionFoldRanges,
  buildSectionSymbols,
  getSectionOutline,
  sectionOutlineByStartLine,
  sectionText,
} from "../parser/sectionOutline";
export type { SectionFoldRange, SectionSymbolInfo } from "../parser/sectionOutline";
