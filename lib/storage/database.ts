import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import {
  extensionFor,
  isSupportedMediaType,
  type StorageAdapter,
  type StoredImage,
} from '@/lib/storage/adapter';

/**
 * Photos in the database.
 *
 * This exists so the app works on a serverless host with nothing but a Postgres
 * connection. Requiring an object store to be provisioned before a photo can be uploaded
 * costs a setup step, and when it is missing the upload fails with nothing to point at.
 *
 * The trade-off, stated plainly: object storage is the right home for images at scale —
 * it is cheaper per byte, it streams, and it keeps large blobs out of your backups. A
 * resized phone photo is a few hundred kilobytes and a prototype takes a handful a day,
 * so Postgres carries that comfortably. When you outgrow it, set BLOB_READ_WRITE_TOKEN
 * and the Vercel Blob adapter takes over — the key format is identical, so existing rows
 * keep working and nothing needs migrating.
 */
export class DatabaseStorage implements StorageAdapter {
  readonly name = 'database';

  async put(data: Buffer, mediaType: string): Promise<StoredImage> {
    if (!isSupportedMediaType(mediaType)) {
      throw new Error(`Unsupported image type "${mediaType}".`);
    }
    const key = `${randomUUID()}.${extensionFor(mediaType)}`;
    await prisma.storedImage.create({
      // Prisma's Bytes maps to Uint8Array; a Buffer IS one, but its backing store is
      // typed loosely enough that TypeScript will not accept it without this.
      data: { key, mediaType, bytes: data.byteLength, data: new Uint8Array(data) },
    });
    return { key, mediaType, bytes: data.byteLength };
  }

  async get(key: string): Promise<{ data: Buffer; mediaType: string }> {
    const row = await prisma.storedImage.findUnique({ where: { key } });
    if (!row) throw new Error(`No stored image ${key}.`);
    return { data: Buffer.from(row.data), mediaType: row.mediaType };
  }

  async delete(key: string): Promise<void> {
    await prisma.storedImage.deleteMany({ where: { key } });
  }
}
