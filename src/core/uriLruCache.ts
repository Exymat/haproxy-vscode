/** LRU cache keyed by URI with content-fingerprint invalidation. */
interface UriCacheFingerprint<T> {
  fingerprint: string;
  value: T;
}

interface UriCacheEntry<T> extends UriCacheFingerprint<T> {
  previous?: UriCacheFingerprint<T>;
}

export class UriLruCache<T> {
  private readonly map = new Map<string, UriCacheEntry<T>>();

  constructor(private readonly maxEntries: number) {}

  get(uriKey: string, fingerprint: string): T | undefined {
    const hit = this.map.get(uriKey);
    if (!hit) {
      return undefined;
    }
    if (hit.fingerprint === fingerprint) {
      this.map.delete(uriKey);
      this.map.set(uriKey, hit);
      return hit.value;
    }
    if (hit.previous?.fingerprint === fingerprint) {
      this.map.delete(uriKey);
      this.map.set(uriKey, hit);
      return hit.previous.value;
    }
    return undefined;
  }

  set(uriKey: string, fingerprint: string, value: T): void {
    const existing = this.map.get(uriKey);
    if (existing) {
      this.map.delete(uriKey);
    }
    const previous =
      existing && existing.fingerprint !== fingerprint
        ? { fingerprint: existing.fingerprint, value: existing.value }
        : existing?.previous;
    this.map.set(uriKey, { fingerprint, value, previous });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  has(uriKey: string): boolean {
    return this.map.has(uriKey);
  }

  delete(uriKey: string): void {
    this.map.delete(uriKey);
  }

  clear(): void {
    this.map.clear();
  }
}
