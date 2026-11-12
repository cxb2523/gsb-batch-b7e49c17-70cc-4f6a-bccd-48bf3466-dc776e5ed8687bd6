/**
 * Image downscaling, format optimization, and data URL helpers (Batch 17).
 *
 * Decision 6:
 * In the browser, an image is downscaled to at most 2048px on its longer side and re-encoded
 * (WebP, falling back to JPEG, keeping PNG only when it has transparency and is small)
 * before it is added; the original is never stored. Files over the per-file cap (8MB)
 * after re-encoding are refused with an ImageTooLargeError.
 */

export const MAX_IMAGE_DIMENSION = 2048;
export const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
export const DEFAULT_QUALITY = 0.85;
export const SMALL_PNG_THRESHOLD_BYTES = 256 * 1024; // 256KB

export class ImageTooLargeError extends Error {
  readonly code = 'image-too-large' as const;

  constructor(message = 'Image exceeds maximum size of 8MB') {
    super(message);
    this.name = 'ImageTooLargeError';
  }
}

/**
 * Calculates scaled dimensions keeping aspect ratio so that max(width, height) <= maxDimension.
 */
export function calculateTargetDimensions(
  width: number,
  height: number,
  maxDimension = MAX_IMAGE_DIMENSION,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  if (width >= height) {
    const scale = maxDimension / width;
    return {
      width: maxDimension,
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  const scale = maxDimension / height;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: maxDimension,
  };
}

interface LoadedImage {
  width: number;
  height: number;
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  close(): void;
}

async function loadSourceImage(file: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function' && file.type !== 'image/svg+xml') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw(ctx: CanvasRenderingContext2D, width: number, height: number) {
          ctx.drawImage(bitmap, 0, 0, width, height);
        },
        close() {
          bitmap.close();
        },
      };
    } catch {
      // Fall back to Image element if createImageBitmap fails
    }
  }

  return new Promise<LoadedImage>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw(ctx: CanvasRenderingContext2D, width: number, height: number) {
          ctx.drawImage(img, 0, 0, width, height);
        },
        close() {
          // No resource cleanup required for Image
        },
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image file.'));
    };

    img.src = url;
  });
}

function checkCanvasTransparency(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    for (let i = 3; i < data.length; i += 4) {
      const alpha = data[i];
      if (alpha !== undefined && alpha < 255) {
        return true;
      }
    }
  } catch {
    // If getImageData fails (tainted canvas or unavailable), assume no transparency
  }
  return false;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(`Failed to encode canvas to ${mimeType}`));
        }
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Downscales an image to at most 2048px on its longer side, chooses an optimized format
 * (WebP, falling back to JPEG, keeping PNG only when it has transparency and is small),
 * validates the per-file size cap (8MB), and returns the binary data and MIME type.
 */
export async function processImageFile(
  file: File | Blob,
): Promise<{ data: Uint8Array<ArrayBuffer>; mimeType: string }> {
  const source = await loadSourceImage(file);

  try {
    const { width, height } = calculateTargetDimensions(source.width, source.height);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D rendering context is not available.');
    }

    source.draw(ctx, width, height);

    const hasTransparency = checkCanvasTransparency(ctx, width, height);

    let selectedBlob: Blob;

    if (hasTransparency) {
      let webpBlob: Blob | null = null;
      try {
        const b = await canvasToBlob(canvas, 'image/webp', DEFAULT_QUALITY);
        if (b.type === 'image/webp') {
          webpBlob = b;
        }
      } catch {
        // WebP encoding unsupported or failed
      }

      if (!webpBlob) {
        // Fall back to PNG
        selectedBlob = await canvasToBlob(canvas, 'image/png');
      } else {
        // WebP supported: check if PNG is small and worth keeping
        try {
          const pngBlob = await canvasToBlob(canvas, 'image/png');
          if (pngBlob.size <= SMALL_PNG_THRESHOLD_BYTES && pngBlob.size <= webpBlob.size) {
            selectedBlob = pngBlob;
          } else {
            selectedBlob = webpBlob;
          }
        } catch {
          selectedBlob = webpBlob;
        }
      }
    } else {
      let webpBlob: Blob | null = null;
      try {
        const b = await canvasToBlob(canvas, 'image/webp', DEFAULT_QUALITY);
        if (b.type === 'image/webp') {
          webpBlob = b;
        }
      } catch {
        // WebP encoding unsupported or failed
      }

      if (webpBlob) {
        selectedBlob = webpBlob;
      } else {
        selectedBlob = await canvasToBlob(canvas, 'image/jpeg', DEFAULT_QUALITY);
      }
    }

    if (selectedBlob.size > MAX_FILE_BYTES) {
      throw new ImageTooLargeError('Image exceeds maximum size of 8MB');
    }

    const arrayBuffer = await selectedBlob.arrayBuffer();
    return {
      data: new Uint8Array(arrayBuffer),
      mimeType: selectedBlob.type,
    };
  } finally {
    source.close();
  }
}

/**
 * Converts a data URL to binary bytes and its MIME type.
 */
export function dataUrlToBytes(dataUrl: string): {
  data: Uint8Array<ArrayBuffer>;
  mimeType: string;
} {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1 || !dataUrl.startsWith('data:')) {
    throw new Error('Invalid data URL format.');
  }

  const header = dataUrl.slice(5, commaIndex);
  const base64Data = dataUrl.slice(commaIndex + 1);
  const isBase64 = header.endsWith(';base64');
  const mimeType = isBase64
    ? header.slice(0, -7) || 'application/octet-stream'
    : header || 'application/octet-stream';

  if (isBase64) {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { data: bytes, mimeType };
  }

  const decoded = decodeURIComponent(base64Data);
  const bytes = new TextEncoder().encode(decoded);
  return { data: bytes, mimeType };
}

/**
 * Converts binary bytes and MIME type to a standard base64 data URL.
 */
export function bytesToDataUrl(data: Uint8Array, mimeType: string): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte !== undefined) {
      binary += String.fromCharCode(byte);
    }
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
