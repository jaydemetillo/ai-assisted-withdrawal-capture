import { randomUUID } from 'node:crypto';
import { del, list, put } from '@vercel/blob';
import {
  extensionFor,
  isSupportedMediaType,
  type StorageAdapter,
  type StoredImage,
} from '@/lib/storage/adapter';

/**
 * Vercel Blob storage, used automatically when BLOB_READ_WRITE_TOKEN is set.
 *
 * A serverless host gives every request its own disposable disk, so local-disk storage
 * silently loses photos there. This adapter keeps the SAME key format as local disk
 * (`<uuid>.jpg`) and stores under `captures/<key>`, so a database row is portable
 * between the two and no other code changes.
 *
 * Honest caveat: Vercel Blob objects are served from an unguessable public URL. That
 * URL is never sent to a browser — every read goes through /api/images/[key], which
 * checks the session and a per-user expiring token — but "unguessable" is not "private".
 * A deployment that needs private-at-rest storage should use an S3-style store with
 * signed access. See the README.
 */
const PREFIX = 'captures/';
const KEY_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp|bin)$/;

export class VercelBlobStorage implements StorageAdapter {
  readonly name = 'vercel-blob';

  async put(data: Buffer, mediaType: string): Promise<StoredImage> {
    if (!isSupportedMediaType(mediaType)) {
      throw new Error(`Unsupported image type "${mediaType}".`);
    }
    const key = `${randomUUID()}.${extensionFor(mediaType)}`;
    await put(`${PREFIX}${key}`, data, {
      access: 'public',
      contentType: mediaType,
      // The key is already a UUID; a random suffix would only stop us finding it again.
      addRandomSuffix: false,
    });
    return { key, mediaType, bytes: data.byteLength };
  }

  async get(key: string): Promise<{ data: Buffer; mediaType: string }> {
    const url = await this.urlFor(key);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read stored image ${key}.`);
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    const url = await this.urlFor(key).catch(() => null);
    if (url) await del(url);
  }

  private async urlFor(key: string): Promise<string> {
    if (!KEY_PATTERN.test(key)) throw new Error('Malformed image key.');
    const { blobs } = await list({ prefix: `${PREFIX}${key}`, limit: 1 });
    const blob = blobs.find((b) => b.pathname === `${PREFIX}${key}`);
    if (!blob) throw new Error(`No stored image ${key}.`);
    return blob.url;
  }
}
