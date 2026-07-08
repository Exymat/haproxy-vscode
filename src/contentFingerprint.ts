import { createHash } from "node:crypto";

export function fingerprintText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
