/// <reference types="vite/client" />
/**
 * Browser codecs for ArtifactPipeline (PDF.js, canvas decode, jsPDF).
 * Injected so Module tests can substitute deterministic rasters.
 */
import { polishArtifactMessage, type ArtifactMessageKey } from '@pilot/artifactContract';

export class ArtifactCodecError extends Error {
  constructor(readonly key: ArtifactMessageKey, message: string) {
    super(message);
    this.name = 'ArtifactCodecError';
  }
}

export type RasterPage = {
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  dataUrl: string;
  encodedBytes: number;
  pixels: number;
  release: () => void;
};

export type SceneTileInput = {
  elements: readonly Record<string, unknown>[];
  bounds: { x1: number; y1: number; x2: number; y2: number };
  pageWidth: number;
  pageHeight: number;
  smoothingFactor: number;
  draw: (ctx: CanvasRenderingContext2D, elements: readonly Record<string, unknown>[]) => void;
};

export interface ArtifactCodecs {
  inspectPdf(
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Promise<{ pages: { width: number; height: number }[] }>;
  renderPdfPage(
    bytes: Uint8Array,
    pageIndex: number,
    scale: number,
    signal?: AbortSignal
  ): Promise<RasterPage>;
  decodeImage(
    bytes: Uint8Array,
    mime: string,
    signal?: AbortSignal,
    maxPixels?: number
  ): Promise<RasterPage>;
  writePdf(pages: { dataUrl: string }[], options?: { labels?: boolean }): Promise<Uint8Array>;
  releasePdf?(bytes: Uint8Array): Promise<void>;
}

const bytesToBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const releaseCanvas = (canvas: HTMLCanvasElement | OffscreenCanvas | null): void => {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
};

const dataUrlBytes = (dataUrl: string): number => Math.ceil(((dataUrl.split(',')[1] ?? '').length * 3) / 4);

let pdfjsConfigured = false;
let cachedPdfjs: typeof import('pdfjs-dist') | null = null;

const loadPdfjs = async () => {
  if (cachedPdfjs) return cachedPdfjs;
  const [pdfjsLib, worker, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    import('pdfjs-dist/build/pdf.worker.min.mjs')
  ]);
  if (!pdfjsConfigured) {
    // Register the worker message handler on the main thread: some embedded
    // browsers deadlock rendering inside a module Worker, and this is pdf.js's
    // supported fallback path (same handler, no cross-thread round trip).
    (globalThis as Record<string, unknown>).pdfjsWorker = workerModule;
    if (worker.default) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
    }
    pdfjsConfigured = true;
  }
  cachedPdfjs = pdfjsLib;
  return pdfjsLib;
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new ArtifactCodecError('artifact.cancelled', 'Import cancelled.');
};

const rasterFromCanvas = (
  canvas: HTMLCanvasElement,
  displayWidth: number,
  displayHeight: number,
  mime: 'image/jpeg' | 'image/png',
  quality = 0.84
): RasterPage => {
  const dataUrl = canvas.toDataURL(mime, quality);
  const width = canvas.width;
  const height = canvas.height;
  releaseCanvas(canvas);
  return {
    width,
    height,
    displayWidth,
    displayHeight,
    dataUrl,
    encodedBytes: dataUrlBytes(dataUrl),
    pixels: width * height,
    release: () => {
      /* data URL is the remaining allocation; callers drop the reference */
    }
  };
};

const computePdfHash = async (bytes: Uint8Array): Promise<string> => {
  if (typeof crypto !== 'undefined' && crypto?.subtle?.digest) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // fallback
    }
  }
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  const step = Math.max(1, Math.floor(bytes.length / 64));
  for (let i = 0; i < bytes.length; i += step) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h2 = Math.imul(h2 ^ bytes[i], 0x01000193);
  }
  return `${bytes.byteLength}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
};

export const createBrowserArtifactCodecs = (
  options?: { maxDecodedPixels?: number }
): ArtifactCodecs => {
  const pdfDocuments = new Map<string, Promise<any>>();
  const defaultMaxPixels = options?.maxDecodedPixels ?? 16_000_000;

  const loadPdf = async (bytes: Uint8Array, signal?: AbortSignal) => {
    throwIfAborted(signal);
    const key = await computePdfHash(bytes);
    throwIfAborted(signal);
    let pending = pdfDocuments.get(key);
    if (!pending) {
      pending = (async () => {
        const pdfjsLib = await loadPdfjs();
        try {
          return await pdfjsLib.getDocument({ data: bytesToBuffer(bytes) }).promise;
        } catch (error) {
          const message = (error as Error).message || '';
          if (/password|encrypt/i.test(message)) {
            throw new ArtifactCodecError('artifact.encrypted', message);
          }
          throw new ArtifactCodecError('artifact.malformed', message || 'Malformed PDF.');
        }
      })();
      pdfDocuments.set(key, pending);
    }
    try {
      return await pending;
    } catch (error) {
      pdfDocuments.delete(key);
      throw error;
    }
  };

  const releasePdf = async (bytes: Uint8Array) => {
    try {
      const key = await computePdfHash(bytes);
      const pending = pdfDocuments.get(key);
      if (pending) {
        pdfDocuments.delete(key);
        const pdf = await pending;
        if (typeof pdf?.destroy === 'function') {
          await pdf.destroy();
        }
      }
    } catch {
      // ignore
    }
  };

  return {
    inspectPdf: async (bytes, signal) => {
      const pdf = await loadPdf(bytes, signal);
      throwIfAborted(signal);
      const pages: { width: number; height: number }[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        throwIfAborted(signal);
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        pages.push({ width: viewport.width, height: viewport.height });
      }
      return { pages };
    },

    renderPdfPage: async (bytes, pageIndex, scale, signal) => {
      const pdf = await loadPdf(bytes, signal);
      throwIfAborted(signal);
      const page = await pdf.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        releaseCanvas(canvas);
        throw new ArtifactCodecError('artifact.decodeFailed', 'Canvas unavailable.');
      }
      // `intent: 'print'` renders through the microtask scheduler instead of
      // requestAnimationFrame, which never fires in embedded webviews that
      // suspend frame callbacks for backgrounded panes (the default display
      // intent would deadlock there, leaving renderTask.promise pending).
      const renderTask = page.render({ canvasContext: ctx, viewport, intent: 'print' });
      const onAbort = () => {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
      try {
        await renderTask.promise;
        throwIfAborted(signal);
        const raster = rasterFromCanvas(canvas, base.width, base.height, 'image/jpeg', 0.84);
        return raster;
      } catch (error) {
        releaseCanvas(canvas);
        if (signal?.aborted || (error as Error)?.name === 'RenderingCancelledException') {
          throw new ArtifactCodecError('artifact.cancelled', 'PDF rendering cancelled.');
        }
        if (error instanceof ArtifactCodecError) throw error;
        throw new ArtifactCodecError('artifact.decodeFailed', (error as Error).message);
      } finally {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      }
    },

    decodeImage: async (bytes, mime, signal, maxPixels) => {
      throwIfAborted(signal);
      const blob = new Blob([bytesToBuffer(bytes)], { type: mime });
      const objectUrl = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          const timer = window.setTimeout(() => {
            image.src = '';
            reject(new ArtifactCodecError('artifact.decodeFailed', 'Image decode timed out.'));
          }, 12_000);
          image.onload = () => {
            window.clearTimeout(timer);
            resolve(image);
          };
          image.onerror = () => {
            window.clearTimeout(timer);
            reject(new ArtifactCodecError('artifact.decodeFailed', 'Image decode failed.'));
          };
          image.src = objectUrl;
        });
        throwIfAborted(signal);
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) {
          throw new ArtifactCodecError('artifact.decodeFailed', 'Image has no dimensions.');
        }
        const pixels = width * height;
        const limitPixels = maxPixels ?? defaultMaxPixels;
        if (pixels > limitPixels) {
          img.src = '';
          throw new ArtifactCodecError(
            'resource.imageTooLarge',
            polishArtifactMessage('resource.imageTooLarge')
          );
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          releaseCanvas(canvas);
          throw new ArtifactCodecError('artifact.decodeFailed', 'Canvas unavailable.');
        }
        ctx.drawImage(img, 0, 0);
        img.src = '';
        const outputMime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
        return rasterFromCanvas(canvas, width, height, outputMime, 0.84);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },

    writePdf: async (pages, options) => {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF('portrait', 'pt', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      pages.forEach((page, index) => {
        if (index > 0) pdf.addPage();
        pdf.addImage(page.dataUrl, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
        if (options?.labels) {
          pdf.setFontSize(10);
          pdf.text(`Strona ${index + 1}`, pageW - 72, pageH - 18);
        }
      });
      const output = pdf.output('arraybuffer');
      return new Uint8Array(output);
    },

    releasePdf
  };
};

export const yieldToEventLoop = (): Promise<void> =>
  // setTimeout, not requestAnimationFrame: embedded webviews suspend frame
  // callbacks for backgrounded panes, which would stall the generator forever.
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
