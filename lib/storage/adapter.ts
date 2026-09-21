/**
 * Object storage, behind an interface.
 *
 * Local disk in development; an object store in production. Nothing above this layer
 * knows which — a stored image is an opaque key, never a path, so a key can never be
 * concatenated into a filesystem location by accident.
 */
export type StoredImage = {
  key: string;
  mediaType: string;
  bytes: number;
};

export interface StorageAdapter {
  readonly name: string;
  put(data: Buffer, mediaType: string): Promise<StoredImage>;
  get(key: string): Promise<{ data: Buffer; mediaType: string }>;
  delete(key: string): Promise<void>;
}

export const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value);
}

export function extensionFor(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/webp') return 'webp';
  return 'bin';
}
