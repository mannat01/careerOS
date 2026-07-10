
/**
 * ObjectStorage — injectable boundary over S3-compatible artifact storage.
 * Real MinIO locally (minio-object-storage.ts); in-memory fake in CI/e2e.
 * Keys are namespaced per user: `${userId}/...` so hard-delete can cascade
 * by prefix.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer | string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Delete every object under the prefix; returns the number removed. */
  deletePrefix(prefix: string): Promise<number>;
}

/** In-memory fake — used by e2e/CI so no MinIO service is needed. */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Buffer>();

  put(key: string, body: Buffer | string): Promise<void> {
    this.objects.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
    return Promise.resolve();
  }

  list(prefix: string): Promise<string[]> {
    return Promise.resolve([...this.objects.keys()].filter((k) => k.startsWith(prefix)));
  }

  deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }

  /** Test helper: total object count. */
  size(): number {
    return this.objects.size;
  }
}
