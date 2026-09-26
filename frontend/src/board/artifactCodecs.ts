/// <reference types="vite/client" />
/**
 * Browser codecs for ArtifactPipeline (PDF.js, canvas decode, jsPDF).
 * Injected so Module tests can substitute deterministic rasters.
 */
import { polishArtifactMessage, type ArtifactMessageKey } from '@pilot/artifactContract';
import { imageDimensions } from './imageDimensions';

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
  writePdf(pages: { dataUrl: string }[], options?: { labels?: boolean; signal?: AbortSignal }): Promise<Uint8Array>;
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

export const createBrowserArtifactCodecs = (
  options?: { maxDecodedPixels?: number; maxPdfPages?: number }
): ArtifactCodecs => {
  // The pipeline supplies a private byte array for each import. Ownership is
  // by job identity, never content hash: equal files can be imported concurrently.
  const pdfDocuments = new Map<Uint8Array, {
    promise: Promise<import('pdfjs-dist').PDFDocumentProxy>;
    dispose: () => Promise<void>;
  }>();
  const defaultMaxPixels = options?.maxDecodedPixels ?? 16_000_000;

  const releasePdf = async (bytes: Uint8Array) => {
    const record = pdfDocuments.get(bytes);
    if (!record) return;
    pdfDocuments.delete(bytes);
    await record.dispose();
  };

  const loadPdf = async (bytes: Uint8Array, signal?: AbortSignal) => {
    throwIfAborted(signal);
    let record = pdfDocuments.get(bytes);
    if (!record) {
      const loading = loadPdfjs().then((pdfjs) => {
        throwIfAborted(signal);
        return pdfjs.getDocument({ data: bytesToBuffer(bytes) });
      });
      let onAbort = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          reject(new ArtifactCodecError('artifact.cancelled', 'PDF loading cancelled.'));
          void releasePdf(bytes).catch(() => {});
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      record = {
        promise: Promise.race([loading.then((task) => task.promise), cancelled]),
        dispose: async () => {
          signal?.removeEventListener('abort', onAbort);
          await (await loading).destroy();
        }
      };
      pdfDocuments.set(bytes, record);
    }
    try {
      return await record.promise;
    } catch (error) {
      await releasePdf(bytes).catch(() => {});
      if (signal?.aborted) throw new ArtifactCodecError('artifact.cancelled', 'PDF loading cancelled.');
      if (error instanceof ArtifactCodecError) throw error;
      const message = (error as Error).message || '';
      throw new ArtifactCodecError(/password|encrypt/i.test(message) ? 'artifact.encrypted' : 'artifact.malformed', message || 'Malformed PDF.');
    }
  };

  return {
    inspectPdf: async (bytes, signal) => {
      try {
        const pdf = await loadPdf(bytes, signal);
        throwIfAborted(signal);
        if (pdf.numPages > (options?.maxPdfPages ?? 40)) {
          throw new ArtifactCodecError('resource.pdfTooManyPages', polishArtifactMessage('resource.pdfTooManyPages'));
        }
        const pages: { width: number; height: number }[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          throwIfAborted(signal);
          const page = await pdf.getPage(pageNumber);
          try {
            const viewport = page.getViewport({ scale: 1 });
            pages.push({ width: viewport.width, height: viewport.height });
          } finally {
            page.cleanup();
          }
        }
        return { pages };
      } finally {
        await releasePdf(bytes).catch(() => {});
      }
    },

    renderPdfPage: async (bytes, pageIndex, scale, signal) => {
      const pdf = await loadPdf(bytes, signal);
      throwIfAborted(signal);
      const page = await pdf.getPage(pageIndex + 1);
      let canvas: HTMLCanvasElement | null = null;
      let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
      const onAbort = () => {
        try {
          renderTask?.cancel();
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
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale });
        // Validate the real viewport before any canvas backing store is allocated.
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        if (!Number.isFinite(width) || !Number.isFinite(height) || viewport.width <= 0 || viewport.height <= 0 || width * height > defaultMaxPixels) {
          throw new ArtifactCodecError('resource.imageTooLarge', polishArtifactMessage('resource.imageTooLarge'));
        }
        throwIfAborted(signal);
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          throw new ArtifactCodecError('artifact.decodeFailed', 'Canvas unavailable.');
        }
        // `intent: 'print'` renders through the microtask scheduler instead of
        // requestAnimationFrame, which never fires in embedded webviews that
        // suspend frame callbacks for backgrounded panes (the default display
        // intent would deadlock there, leaving renderTask.promise pending).
        renderTask = page.render({ canvasContext: ctx, viewport, intent: 'print' });
        await renderTask.promise;
        throwIfAborted(signal);
        const raster = rasterFromCanvas(canvas, base.width, base.height, 'image/jpeg', 0.84);
        canvas = null;
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
        page.cleanup();
      }
    },

    decodeImage: async (bytes, mime, signal, maxPixels) => {
      throwIfAborted(signal);
      const dimensions = imageDimensions(bytes, mime);
      const limitPixels = maxPixels ?? defaultMaxPixels;
      if (dimensions && (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > limitPixels)) {
        throw new ArtifactCodecError('resource.imageTooLarge', polishArtifactMessage('resource.imageTooLarge'));
      }
      const blob = new Blob([bytesToBuffer(bytes)], { type: mime });
      const objectUrl = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          const cleanup = () => {
            window.clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            image.onload = null;
            image.onerror = null;
          };
          const fail = (error: ArtifactCodecError) => {
            cleanup();
            image.src = '';
            reject(error);
          };
          const onAbort = () => fail(new ArtifactCodecError('artifact.cancelled', 'Image decoding cancelled.'));
          const timer = window.setTimeout(() => {
            fail(new ArtifactCodecError('artifact.decodeFailed', 'Image decode timed out.'));
          }, 12_000);
          image.onload = () => {
            cleanup();
            resolve(image);
          };
          image.onerror = () => fail(new ArtifactCodecError('artifact.decodeFailed', 'Image decode failed.'));
          signal?.addEventListener('abort', onAbort, { once: true });
          image.src = objectUrl;
        });
        throwIfAborted(signal);
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) {
          throw new ArtifactCodecError('artifact.decodeFailed', 'Image has no dimensions.');
        }
        const pixels = width * height;
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
      throwIfAborted(options?.signal);
      const { jsPDF } = await import('jspdf');
      throwIfAborted(options?.signal);
      const pdf = new jsPDF('portrait', 'pt', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      for (const [index, page] of pages.entries()) {
        throwIfAborted(options?.signal);
        if (index > 0) pdf.addPage();
        pdf.addImage(page.dataUrl, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
        if (options?.labels) {
          pdf.setFontSize(10);
          pdf.text(`Strona ${index + 1}`, pageW - 72, pageH - 18);
        }
        await yieldToEventLoop();
      }
      throwIfAborted(options?.signal);
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
