import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drawElement, preloadCanvasImages } from '@/utils/canvasDrawing.js';

describe('canvas image preload used by artifact export', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', class {
      constructor() {
        this.complete = false;
        this.naturalWidth = 0;
        this.onload = null;
        this.onerror = null;
      }

      set src(value) {
        this._src = value;
        queueMicrotask(() => {
          this.complete = true;
          this.naturalWidth = 1;
          this.width = 1;
          this.height = 1;
          this.onload?.();
        });
      }

      get src() {
        return this._src;
      }
    });
  });

  it('warms the same cache drawElement reads synchronously', async () => {
    const src = 'data:image/png;base64,AA==';
    const imageCache = new Map();
    await preloadCanvasImages([{ type: 'image', src }], imageCache);

    const context = {
      canvas: {},
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn()
    };
    drawElement(
      context,
      { type: 'image', src, x: 10, y: 20, width: 30, height: 40 },
      false,
      0.65,
      imageCache,
      undefined,
      {},
      {}
    );

    expect(context.drawImage).toHaveBeenCalledTimes(1);
    expect(context.drawImage.mock.calls[0][0]).toMatchObject({ naturalWidth: 1 });
  });

  it('loads sequentially under an aggregate decoded-pixel budget', async () => {
    const cache = new Map();
    await expect(preloadCanvasImages([
      { type: 'image', src: 'data:image/png;base64,AA==' },
      { type: 'image', src: 'data:image/png;base64,BB==' }
    ], cache, { maxTotalPixels: 1 })).rejects.toMatchObject({ code: 'resource.imageTooLarge' });
    expect(cache.size).toBe(2);
  });
});
