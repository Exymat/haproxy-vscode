interface UriCacheEntry<T> {
  fingerprint: string;
  value: T;
}

export class UriLruCache<T> {
  private readonly map = new Map<string, UriCacheEntry<T>>();

  constructor(private readonly maxEntries: number) {}

  get(uriKey: string, fingerprint: string): T | undefined {
    const hit = this.map.get(uriKey);
    if (!hit || hit.fingerprint !== fingerprint) {
      return undefined;
    }
    this.map.delete(uriKey);
    this.map.set(uriKey, hit);
    return hit.value;
  }

  set(uriKey: string, fingerprint: string, value: T): void {
    if (this.map.has(uriKey)) {
      this.map.delete(uriKey);
    }
    this.map.set(uriKey, { fingerprint, value });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  delete(uriKey: string): void {
    this.map.delete(uriKey);
  }

  clear(): void {
    this.map.clear();
  }
}
