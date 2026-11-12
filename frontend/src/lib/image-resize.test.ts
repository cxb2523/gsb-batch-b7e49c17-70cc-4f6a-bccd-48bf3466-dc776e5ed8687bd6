import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ImageTooLargeError,
  MAX_FILE_BYTES,
  MAX_IMAGE_DIMENSION,
  bytesToDataUrl,
  calculateTargetDimensions,
  dataUrlToBytes,
  processImageFile,
} from './image-resize';

describe('calculateTargetDimensions', () => {
  it('preserves dimensions when both width and height are within max bounds', () => {
    expect(calculateTargetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(calculateTargetDimensions(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION)).toEqual({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
    });
  });

  it('scales wide images proportionally so that width equals maxDimension', () => {
    const { width, height } = calculateTargetDimensions(4096, 2048);
    expect(width).toBe(2048);
    expect(height).toBe(1024);
  });

  it('scales tall images proportionally so that height equals maxDimension', () => {
    const { width, height } = calculateTargetDimensions(1024, 4096);
    expect(width).toBe(512);
    expect(height).toBe(2048);
  });

  it('scales square images larger than max bounds to maxDimension', () => {
    const { width, height } = calculateTargetDimensions(3000, 3000);
    expect(width).toBe(2048);
    expect(height).toBe(2048);
  });

  it('never returns dimension less than 1', () => {
    const { width, height } = calculateTargetDimensions(10000, 1);
    expect(width).toBe(2048);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});

describe('dataUrlToBytes and bytesToDataUrl', () => {
  it('round-trips binary data with mime type through data URL', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 250, 255]);
    const mimeType = 'image/png';
    const dataUrl = bytesToDataUrl(bytes, mimeType);

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const parsed = dataUrlToBytes(dataUrl);
    expect(parsed.mimeType).toBe(mimeType);
    expect(Array.from(parsed.data)).toEqual(Array.from(bytes));
  });

  it('handles URL-encoded data URLs', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    const parsed = dataUrlToBytes(dataUrl);

    expect(parsed.mimeType).toBe('image/svg+xml');
    const text = new TextDecoder().decode(parsed.data);
    expect(text).toBe(svg);
  });

  it('throws on invalid data URL string', () => {
    expect(() => dataUrlToBytes('invalid-data-url')).toThrow('Invalid data URL format.');
    expect(() => dataUrlToBytes('http://example.com/test.png')).toThrow('Invalid data URL format.');
  });
});

function isCanvas2DContext(value: unknown): value is CanvasRenderingContext2D {
  return (
    typeof value === 'object' && value !== null && 'drawImage' in value && 'getImageData' in value
  );
}

describe('processImageFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setupCanvasMocks(options: {
    hasTransparency?: boolean;
    supportsWebp?: boolean;
    webpSize?: number;
    pngSize?: number;
    jpegSize?: number;
  }) {
    const {
      hasTransparency = false,
      supportsWebp = true,
      webpSize = 5000,
      pngSize = 8000,
      jpegSize = 6000,
    } = options;

    const mockBitmap = {
      width: 3000,
      height: 1500,
      close: vi.fn(),
    };

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(mockBitmap));

    const mockCtx: unknown = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockImplementation(() => {
        const alpha = hasTransparency ? 128 : 255;
        return {
          data: new Uint8ClampedArray([255, 0, 0, alpha]),
          width: 1,
          height: 1,
        };
      }),
    };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      contextId: string,
    ) {
      if (contextId === '2d' && isCanvas2DContext(mockCtx)) {
        return mockCtx;
      }
      return null;
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type = 'image/png',
    ) {
      if (type === 'image/webp' && !supportsWebp) {
        const blob = new Blob([new Uint8Array(pngSize)], { type: 'image/png' });
        callback(blob);
        return;
      }

      let size = pngSize;
      if (type === 'image/webp') size = webpSize;
      if (type === 'image/jpeg') size = jpegSize;

      const blob = new Blob([new Uint8Array(size)], { type });
      callback(blob);
    });
  }

  it('downscales and encodes opaque image as WebP when supported', async () => {
    setupCanvasMocks({ hasTransparency: false, supportsWebp: true });

    const inputBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const result = await processImageFile(inputBlob);

    expect(result.mimeType).toBe('image/webp');
    expect(result.data.length).toBe(5000);
  });

  it('falls back to JPEG for opaque image when WebP is unsupported', async () => {
    setupCanvasMocks({ hasTransparency: false, supportsWebp: false });

    const inputBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const result = await processImageFile(inputBlob);

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.data.length).toBe(6000);
  });

  it('encodes transparent image as WebP when supported and PNG is not smaller', async () => {
    setupCanvasMocks({
      hasTransparency: true,
      supportsWebp: true,
      webpSize: 10000,
      pngSize: 300000,
    });

    const inputBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const result = await processImageFile(inputBlob);

    expect(result.mimeType).toBe('image/webp');
    expect(result.data.length).toBe(10000);
  });

  it('keeps PNG when transparent image PNG is small and <= WebP size', async () => {
    setupCanvasMocks({
      hasTransparency: true,
      supportsWebp: true,
      webpSize: 8000,
      pngSize: 4000,
    });

    const inputBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const result = await processImageFile(inputBlob);

    expect(result.mimeType).toBe('image/png');
    expect(result.data.length).toBe(4000);
  });

  it('falls back to PNG for transparent image when WebP is unsupported', async () => {
    setupCanvasMocks({ hasTransparency: true, supportsWebp: false, pngSize: 50000 });

    const inputBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const result = await processImageFile(inputBlob);

    expect(result.mimeType).toBe('image/png');
    expect(result.data.length).toBe(50000);
  });

  it('throws ImageTooLargeError when re-encoded file exceeds 8MB cap', async () => {
    setupCanvasMocks({
      hasTransparency: false,
      supportsWebp: true,
      webpSize: MAX_FILE_BYTES + 1024,
    });

    const inputBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    await expect(processImageFile(inputBlob)).rejects.toBeInstanceOf(ImageTooLargeError);
    await expect(processImageFile(inputBlob)).rejects.toThrow('Image exceeds maximum size of 8MB');
  });
});
