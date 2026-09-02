/** LRU-caches per-document symbol indexes keyed by URI and version. */
export {
  clearSymbolIndexCaches,
  getSymbolIndex,
  getSymbolIndexVersion,
  hasUriSymbolIndexCache,
} from "../document/session";
