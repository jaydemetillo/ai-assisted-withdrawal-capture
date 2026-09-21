import type { StorageAdapter } from '@/lib/storage/adapter';
import { VercelBlobStorage } from '@/lib/storage/blob';
import { DatabaseStorage } from '@/lib/storage/database';
import { LocalDiskStorage } from '@/lib/storage/local';

export * from '@/lib/storage/adapter';

let adapter: StorageAdapter | null = null;

/**
 * The configured storage adapter, in order of preference:
 *
 *   1. **Vercel Blob**, when BLOB_READ_WRITE_TOKEN is set. Best at scale.
 *   2. **The database**, on any serverless host. A serverless disk is per-request and
 *      disposable, so local files are not an option there — but a Postgres row is, and
 *      requiring an object store to be provisioned first is a setup step that buys
 *      nothing for a prototype.
 *   3. **Local disk**, for development.
 *
 * No combination throws. An upload failing because a store was never attached is a bad
 * trade for a deployment nobody has finished configuring.
 */
export function storage(): StorageAdapter {
  if (adapter) return adapter;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    adapter = new VercelBlobStorage();
  } else if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    adapter = new DatabaseStorage();
  } else {
    adapter = new LocalDiskStorage();
  }
  return adapter;
}

/** Test seam. */
export function setStorage(next: StorageAdapter | null): void {
  adapter = next;
}
