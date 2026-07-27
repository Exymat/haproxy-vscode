/** Computes a SHA-256 fingerprint of document text for cache keys. */
import { createHash } from "node:crypto";

export function fingerprintText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
