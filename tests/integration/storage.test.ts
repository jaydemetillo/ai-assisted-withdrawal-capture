import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { DatabaseStorage } from '@/lib/storage/database';
import { setStorage, storage } from '@/lib/storage';
import { describeWithDb } from '../helpers/db';

/**
 * The failure this replaces: on Vercel with no Blob store, `storage()` threw, the upload
 * route returned 500, and the log said only "unhandled route error". Photographing a note
 * failed with nothing to point at.
 */
describeWithDb('image storage', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    setStorage(null);
  });

  afterEach(() => {
    process.env = { ...saved };
    setStorage(null);
  });

  afterAll(async () => {
    await prisma.storedImage.deleteMany();
    await prisma.$disconnect();
  });

  it('round-trips a photo through the database, byte for byte', async () => {
    const adapter = new DatabaseStorage();
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

    const stored = await adapter.put(bytes, 'image/jpeg');
    expect(stored.key).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(stored.bytes).toBe(bytes.byteLength);

    const read = await adapter.get(stored.key);
    expect(read.data).toEqual(bytes);
    expect(read.mediaType).toBe('image/jpeg');

    await adapter.delete(stored.key);
    await expect(adapter.get(stored.key)).rejects.toThrow(/No stored image/);
  });

  it('refuses an image type the rest of the pipeline cannot handle', async () => {
    await expect(new DatabaseStorage().put(Buffer.from('x'), 'application/pdf')).rejects.toThrow(
      /Unsupported image type/,
    );
  });

  it('chooses the database on a serverless host instead of throwing', () => {
    process.env.VERCEL = '1';
    delete process.env.BLOB_READ_WRITE_TOKEN;
    // This used to throw, which is what produced the 500 on upload.
    expect(() => storage()).not.toThrow();
    expect(storage().name).toBe('database');
  });

  it('prefers Vercel Blob when one is attached', () => {
    process.env.VERCEL = '1';
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
    expect(storage().name).toBe('vercel-blob');
  });

  it('uses local disk in development', () => {
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(storage().name).toBe('local-disk');
  });
});
