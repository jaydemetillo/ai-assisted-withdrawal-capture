import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Capture photos have two homes, chosen by environment:
 *
 *  - Local disk (.data/uploads), served back through /api/uploads/[file]. The default,
 *    and all you need for `npm run dev`.
 *  - Vercel Blob, when BLOB_READ_WRITE_TOKEN is set. Required on Vercel and any other
 *    serverless host, because those filesystems are ephemeral and per-instance: a photo
 *    written during the upload request is simply gone by the time the review screen asks
 *    for it.
 *
 * A stored photo is recorded either as a bare filename (local) or as a full https URL
 * (blob); `photoUrl` tells them apart, so switching hosts does not invalidate old rows.
 */
const UPLOAD_DIR = path.join(process.cwd(), '.data', 'uploads');

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function usingBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function extensionFor(mediaType: string): string {
  return EXTENSIONS[mediaType] ?? 'bin';
}

export function mediaTypeFor(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (ext === 'jpeg') return 'image/jpeg';
  const found = Object.entries(EXTENSIONS).find(([, value]) => value === ext);
  return found ? found[0] : 'application/octet-stream';
}

export async function savePhoto(buffer: Buffer, mediaType: string): Promise<string> {
  const name = `${randomUUID()}.${extensionFor(mediaType)}`;

  if (usingBlobStorage()) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`captures/${name}`, buffer, {
      access: 'public',
      contentType: mediaType,
      // The filename is already a UUID; adding a random suffix would only make the
      // stored path harder to correlate with the row.
      addRandomSuffix: false,
    });
    return blob.url;
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), buffer);
  return name;
}

export async function readPhoto(name: string): Promise<Buffer> {
  // basename() keeps a crafted "../../etc/passwd" inside the upload directory.
  const safe = path.basename(name);
  return readFile(path.join(UPLOAD_DIR, safe));
}

export function photoUrl(stored: string): string {
  if (stored.startsWith('http://') || stored.startsWith('https://')) return stored;
  return `/api/uploads/${encodeURIComponent(stored)}`;
}
