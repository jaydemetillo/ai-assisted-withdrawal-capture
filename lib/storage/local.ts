import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  extensionFor,
  isSupportedMediaType,
  type StorageAdapter,
  type StoredImage,
} from '@/lib/storage/adapter';

/**
 * Local-disk storage for development.
 *
 * The key is a UUID plus an extension and is generated here — it is never derived from
 * anything a user supplied, so there is no traversal to defend against. The guard below
 * exists anyway, because "there is no untrusted input here" is exactly the assumption
 * that stops being true one refactor later.
 *
 * A serverless host gives every request its own disposable disk, so this adapter will
 * silently lose images there. Use an object-store adapter in production.
 */
const KEY_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp|bin)$/;

export class LocalDiskStorage implements StorageAdapter {
  readonly name = 'local-disk';

  constructor(private readonly directory = path.join(process.cwd(), '.data', 'uploads')) {}

  async put(data: Buffer, mediaType: string): Promise<StoredImage> {
    if (!isSupportedMediaType(mediaType)) {
      throw new Error(`Unsupported image type "${mediaType}".`);
    }
    const key = `${randomUUID()}.${extensionFor(mediaType)}`;
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.resolve(key), data);
    return { key, mediaType, bytes: data.byteLength };
  }

  async get(key: string): Promise<{ data: Buffer; mediaType: string }> {
    const data = await readFile(this.resolve(key));
    return { data, mediaType: mediaTypeForKey(key) };
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => undefined);
  }

  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Malformed image key.');
    return path.join(this.directory, key);
  }
}

export function mediaTypeForKey(key: string): string {
  if (key.endsWith('.jpg')) return 'image/jpeg';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
