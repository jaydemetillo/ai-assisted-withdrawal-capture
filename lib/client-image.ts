/**
 * Shrink a phone photo in the browser before uploading it.
 *
 * Two reasons, both practical:
 *  - a serverless host caps request bodies (Vercel: 4.5 MB); a modern phone photo is
 *    3–8 MB, so an unresized upload simply fails there;
 *  - iPhones send HEIC, which the server cannot decode. Drawing through a canvas
 *    re-encodes to JPEG in the one place that CAN decode it — the phone itself.
 *
 * 1800 px on the long edge keeps handwriting crisp; the server caps at 1568 px for the
 * model anyway. If decoding fails (an unsupported format on a desktop browser), the
 * original file is sent unchanged rather than nothing.
 */
export const CLIENT_MAX_EDGE_PX = 1800;

export async function prepareForUpload(file: File): Promise<File> {
  if (typeof document === 'undefined') return file;

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    try {
      bitmap = await loadViaImageElement(file);
    } catch {
      return file;
    }
  }

  const width = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const height = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  if (!width || !height) return file;

  const scale = Math.min(1, CLIENT_MAX_EDGE_PX / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const context = canvas.getContext('2d');
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ('close' in bitmap) bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) return file;

  const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}

function loadViaImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('undecodable'));
    };
    image.src = url;
  });
}
