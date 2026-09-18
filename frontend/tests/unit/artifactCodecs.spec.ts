import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserArtifactCodecs } from '@/board/artifactCodecs';

const mock = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ getDocument: mock.getDocument, GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'test-worker' }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs', () => ({}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mock.getDocument.mockReset(); });
const pdfTask = (width = 100, height = 100) => {
  const page = {
    getViewport: ({ scale }) => ({ width: width * scale, height: height * scale }),
    cleanup: vi.fn(), render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  };
  return { promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy: vi.fn(async () => {}), page };
};

describe('browser artifact allocation and ownership', () => {
  it('destroys the PDF after inspection, including when inspection fails', async () => {
    const task = pdfTask(); mock.getDocument.mockReturnValue(task);
    const codecs = createBrowserArtifactCodecs();
    await codecs.inspectPdf(new Uint8Array([1]));
    expect(task.destroy).toHaveBeenCalledOnce();
    task.promise = Promise.resolve({ numPages: 1, getPage: async () => { throw new Error('broken page'); } });
    await expect(codecs.inspectPdf(new Uint8Array([2]))).rejects.toThrow('broken page');
    expect(task.destroy).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized PDF viewports before allocating a canvas', async () => {
    const task = pdfTask(10_000, 10_000); mock.getDocument.mockReturnValue(task);
    const create = vi.spyOn(document, 'createElement');
    const codecs = createBrowserArtifactCodecs({ maxDecodedPixels: 100 });
    const bytes = new Uint8Array([1]);
    await expect(codecs.renderPdfPage(bytes, 0, 1)).rejects.toMatchObject({ key: 'resource.imageTooLarge' });
    expect(create).not.toHaveBeenCalled();
    await codecs.releasePdf!(bytes);
  });

  it('cancels a loading document without waiting for its unresolved promise', async () => {
    const task = { promise: new Promise(() => {}), destroy: vi.fn(async () => {}) };
    mock.getDocument.mockReturnValue(task);
    const abort = new AbortController();
    const pending = createBrowserArtifactCodecs().inspectPdf(new Uint8Array([1]), abort.signal);
    await vi.waitFor(() => expect(mock.getDocument).toHaveBeenCalled());
    abort.abort();
    await expect(pending).rejects.toMatchObject({ key: 'artifact.cancelled' });
    expect(task.destroy).toHaveBeenCalledOnce();
  });

  it('gives equal files in separate jobs independent loading and disposal', async () => {
    const taskA = pdfTask(), taskB = pdfTask();
    mock.getDocument.mockReturnValueOnce(taskA).mockReturnValueOnce(taskB);
    const codecs = createBrowserArtifactCodecs({ maxDecodedPixels: 1 });
    const a = new Uint8Array([1]), b = new Uint8Array([1]);
    await expect(codecs.renderPdfPage(a, 0, 1)).rejects.toMatchObject({ key: 'resource.imageTooLarge' });
    await expect(codecs.renderPdfPage(b, 0, 1)).rejects.toMatchObject({ key: 'resource.imageTooLarge' });
    await codecs.releasePdf!(a);
    expect(taskA.destroy).toHaveBeenCalledOnce();
    expect(taskB.destroy).not.toHaveBeenCalled();
    await codecs.releasePdf!(b);
    expect(taskB.destroy).toHaveBeenCalledOnce();
  });

  it('rejects oversized PNG metadata before creating an Image or object URL', async () => {
    const bytes = new Uint8Array(24);
    bytes.set(new TextEncoder().encode('IHDR'), 12);
    const header = new DataView(bytes.buffer);
    header.setUint32(16, 100_000); header.setUint32(20, 100_000);
    const create = vi.spyOn(URL, 'createObjectURL');
    await expect(createBrowserArtifactCodecs().decodeImage(bytes, 'image/png'))
      .rejects.toMatchObject({ key: 'resource.imageTooLarge' });
    expect(create).not.toHaveBeenCalled();
  });

  it('cancels image loading immediately and revokes the temporary URL', async () => {
    const image = { src: '', onload: null, onerror: null };
    vi.stubGlobal('Image', class { constructor() { return image; } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const abort = new AbortController();
    const pending = createBrowserArtifactCodecs().decodeImage(new Uint8Array([1]), 'image/png', abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ key: 'artifact.cancelled' });
    expect(image.src).toBe('');
    expect(image.onload).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
