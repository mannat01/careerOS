
import { Client as MinioClient } from 'minio';
import type { ObjectStorage } from './object-storage.js';

/**
 * MinIO/S3-backed ObjectStorage — real implementation for local dev.
 * Constructed by the composition root when S3_ENDPOINT + keys are configured.
 */
export class MinioObjectStorage implements ObjectStorage {
  private readonly client: MinioClient;

  constructor(
    private readonly bucket: string,
    opts: { endpoint: string; accessKey: string; secretKey: string },
  ) {
    const url = new URL(opts.endpoint);
    this.client = new MinioClient({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:',
      accessKey: opts.accessKey,
      secretKey: opts.secretKey,
    });
  }

  async put(key: string, body: Buffer | string): Promise<void> {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await this.client.putObject(this.bucket, key, buf);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const stream = this.client.listObjectsV2(this.bucket, prefix, true);
    for await (const obj of stream) {
      if (typeof obj.name === 'string') keys.push(obj.name);
    }
    return keys;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const keys = await this.list(prefix);
    if (keys.length === 0) return 0;
    await this.client.removeObjects(this.bucket, keys);
    return keys.length;
  }
}
