import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createArtifactPipeline, deliverPdfArtifact } from '@/board/artifactPipeline';
import { ArtifactCodecError } from '@/board/artifactCodecs';
import { detectArtifactFormat, polishArtifactMessage, polishPageCount } from '@pilot/artifactContract';
import { createResourceGovernor } from '@pilot/resourceGovernor';
import { createResourceLimits } from '@pilot/resourceLimits';
import { createWhiteboardSession } from '@/board/whiteboardSession';

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
    .split('')
    .map((char) => char.charCodeAt(0))
);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20
]);

const raster = (id, width, height) => ({
  width,
  height,
  displayWidth: width,
  displayHeight: height,
  dataUrl: `data:image/jpeg;base64,${id}`,
  encodedBytes: 32,
  pixels: width * height,
  release() {}
});

const fakeCodecs = (pages = [
  { width: 400, height: 600 },
  { width: 800, height: 400 }
]) => {
  const rendered = [];
  return {
    inspectPdf: async () => ({ pages }),
    renderPdfPage: async (_bytes, pageIndex) => {
      const page = pages[pageIndex];
      rendered.push(pageIndex);
      return raster(`page-${pageIndex}`, page.width, page.height);
    },
    decodeImage: async (_bytes, mime) => raster(mime, 120, 80),
    writePdf: async (exportPages) => {
      const text = `PDF:${exportPages.length}`;
      return new TextEncoder().encode(text);
    },
    rendered
  };
};

const sessionTarget = (session, origin = { x: 40, y: 80 }) => ({
  newObjectId: () => session.newObjectId(),
  origin,
  isEditable: () => session.isEditable(),
  addImage: (object) => session.execute({ kind: 'add', object })
});

describe('ArtifactPipeline Interface', () => {
  it('detects required formats from magic bytes', () => {
    expect(detectArtifactFormat(new TextEncoder().encode('%PDF-1.4\n')).mime).toBe('application/pdf');
    expect(detectArtifactFormat(PNG).mime).toBe('image/png');
    expect(detectArtifactFormat(JPEG).mime).toBe('image/jpeg');
    expect(detectArtifactFormat(WEBP).mime).toBe('image/webp');
    expect(detectArtifactFormat(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatchObject({
      mime: 'image/svg+xml',
      bestEffort: true
    });
    expect(detectArtifactFormat(new Uint8Array([0, 1, 2])).ok).toBe(false);
    const heic = new Uint8Array(32);
    heic.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);
    expect(detectArtifactFormat(heic)).toMatchObject({ mime: 'image/heic', bestEffort: true });
    expect(polishPageCount(1)).toBe('1 stronę');
    expect(polishPageCount(2)).toBe('2 strony');
    expect(polishPageCount(5)).toBe('5 stron');
  });

  it('imports a multi-page PDF in order with preserved proportions', async () => {
    const codecs = fakeCodecs();
    const pipeline = createArtifactPipeline({ codecs, governor: createResourceGovernor() });
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'teacher' });
    const plan = await pipeline.planImport({
      bytes: new TextEncoder().encode('%PDF-1.4 multi'),
      fileName: 'karta.pdf',
      declaredMime: 'application/pdf'
    });
    expect(plan.pageCount).toBe(2);
    const events = [];
    for await (const event of pipeline.import(plan, sessionTarget(session))) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({ phase: 'done', committed: 2 });
    expect(events.at(-1).message).toMatch(/2 strony/);
    const snapshot = session.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).toMatchObject({ type: 'image', width: 400, height: 600, y: 80 });
    expect(snapshot[1]).toMatchObject({ type: 'image', width: 800, height: 400 });
    expect(snapshot[1].y).toBeGreaterThan(snapshot[0].y);
    expect(snapshot[0].width / snapshot[0].height).toBeCloseTo(400 / 600);
    expect(snapshot[1].width / snapshot[1].height).toBeCloseTo(800 / 400);
    session.dispose();
  });

  it('imports PNG, JPEG, and WebP through the same command path', async () => {
    const pipeline = createArtifactPipeline({ codecs: fakeCodecs(), governor: createResourceGovernor() });
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'student' });
    for (const [bytes, mime] of [
      [PNG, 'image/png'],
      [JPEG, 'image/jpeg'],
      [WEBP, 'image/webp']
    ]) {
      const plan = await pipeline.planImport({ bytes, declaredMime: mime });
      let last;
      for await (const event of pipeline.import(plan, sessionTarget(session, { x: 10, y: 20 }))) {
        last = event;
      }
      expect(last.phase).toBe('done');
    }
    expect(session.snapshot()).toHaveLength(3);
    session.dispose();
  });

  it('reports committed pages when cancelled mid-import', async () => {
    const pipeline = createArtifactPipeline({ codecs: fakeCodecs(), governor: createResourceGovernor() });
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'teacher' });
    const plan = await pipeline.planImport({
      bytes: new TextEncoder().encode('%PDF-1.4'),
      declaredMime: 'application/pdf'
    });
    const abort = new AbortController();
    const events = [];
    let pages = 0;
    for await (const event of pipeline.import(plan, sessionTarget(session), abort.signal)) {
      events.push(event);
      if (event.phase === 'committing') {
        pages += 1;
        if (pages === 1) abort.abort();
      }
    }
    expect(events.at(-1).phase).toBe('cancelled');
    expect(events.at(-1).committed).toBe(1);
    expect(events.at(-1).message).toMatch(/Zapisano 1 stronę/);
    expect(session.snapshot()).toHaveLength(1);
    session.dispose();
  });

  it('does not commit a decoded page when cancellation arrives before insertion', async () => {
    const abort = new AbortController();
    const codecs = fakeCodecs([{ width: 400, height: 600 }]);
    codecs.renderPdfPage = async () => {
      abort.abort();
      return raster('cancelled-before-insert', 400, 600);
    };
    const pipeline = createArtifactPipeline({ codecs, governor: createResourceGovernor() });
    const plan = await pipeline.planImport({ bytes: new TextEncoder().encode('%PDF-1.4') });
    let addCalls = 0;
    const events = [];
    for await (const event of pipeline.import(plan, {
      origin: { x: 0, y: 0 },
      newObjectId: () => 'page',
      isEditable: () => true,
      addImage: () => {
        addCalls += 1;
        return { ok: true };
      }
    }, abort.signal)) {
      events.push(event);
    }
    expect(addCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({ phase: 'cancelled', committed: 0 });
  });

  it('rejects oversized and malformed input without mutating the board', async () => {
    const pipeline = createArtifactPipeline({
      codecs: fakeCodecs(),
      governor: createResourceGovernor({
        limits: createResourceLimits({ maxPdfBytes: 8, maxPdfPages: 40 })
      })
    });
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'teacher' });
    await expect(
      pipeline.planImport({
        bytes: new TextEncoder().encode('%PDF-1.4 oversized-file-body'),
        declaredMime: 'application/pdf'
      })
    ).rejects.toBeInstanceOf(ArtifactCodecError);

    const malformed = createArtifactPipeline({
      codecs: {
        ...fakeCodecs(),
        inspectPdf: async () => {
          throw new ArtifactCodecError('artifact.encrypted', 'encrypted');
        }
      }
    });
    await expect(
      malformed.planImport({ bytes: new TextEncoder().encode('%PDF-1.4'), declaredMime: 'application/pdf' })
    ).rejects.toMatchObject({ key: 'artifact.encrypted' });
    expect(session.snapshot()).toHaveLength(0);
    expect(polishArtifactMessage('artifact.encrypted')).toMatch(/hasło/);
    session.dispose();
  });

  it('exports every visible object type from a canonical scene', async () => {
    const pipeline = createArtifactPipeline({
      codecs: fakeCodecs(),
      renderTile: () => 'data:image/jpeg;base64,AAA=',
      drawScene: (ctx, elements) => {
        ctx.fillRect(0, 0, elements.length, 1);
      }
    });
    const scene = [
      { id: 'pen', type: 'pen', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      { id: 'text', type: 'text', x: 20, y: 20, width: 40, height: 16, text: 'Ax=b' },
      { id: 'shape', type: 'rectangle', x: 5, y: 5, width: 30, height: 20 },
      { id: 'line', type: 'line', start: { x: 0, y: 40 }, end: { x: 40, y: 40 } },
      { id: 'image', type: 'image', src: 'data:image/png;base64,AA==', x: 50, y: 50, width: 20, height: 20 }
    ];
    const artifact = await pipeline.export(scene, { mode: 'single' });
    expect(artifact.mime).toBe('application/pdf');
    expect(artifact.pageCount).toBe(1);
    expect(new TextDecoder().decode(artifact.bytes)).toBe('PDF:1');
    await expect(pipeline.export([], { mode: 'single' })).rejects.toMatchObject({
      key: 'artifact.emptyExport'
    });
  });

  it('refuses mutation while the session is read-only and still exports', async () => {
    const pipeline = createArtifactPipeline({
      codecs: fakeCodecs(),
      renderTile: () => 'data:image/jpeg;base64,AAA='
    });
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'student', isEditable: () => false });
    const plan = await pipeline.planImport({ bytes: PNG, declaredMime: 'image/png' });
    const events = [];
    for await (const event of pipeline.import(plan, sessionTarget(session))) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({ phase: 'failed', messageKey: 'artifact.readOnlyMutation' });
    expect(session.snapshot()).toHaveLength(0);

    const writable = createWhiteboardSession({ ydoc, role: 'teacher' });
    writable.execute({
      kind: 'add',
      object: { id: 'kept', type: 'rectangle', x: 1, y: 1, width: 10, height: 10 }
    });
    const artifact = await pipeline.export(writable.snapshot(), { mode: 'paged' });
    expect(artifact.pageCount).toBe(1);
    session.dispose();
    writable.dispose();
  });

  it('delivers PDF through iPad share when available and otherwise downloads', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const artifact = { bytes, mime: 'application/pdf' as const, filename: 'tablica.pdf', pageCount: 1 };
    const share = vi.fn(async () => undefined);
    navigator.canShare = () => true;
    navigator.share = share;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'
    });
    await expect(deliverPdfArtifact(artifact)).resolves.toBe('share');
    expect(share).toHaveBeenCalled();

    const click = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') Object.defineProperty(el, 'click', { value: click });
      return el;
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Windows NT 10.0)'
    });
    await expect(deliverPdfArtifact(artifact)).resolves.toBe('download');
    expect(click).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('isolates physicsDataPlot and plot internal data points from scene bounds calculation', async () => {
    let receivedBounds: { x1: number; y1: number; x2: number; y2: number } | null = null;
    const pipeline = createArtifactPipeline({
      codecs: fakeCodecs(),
      renderTile: ({ tile }) => {
        receivedBounds = tile;
        return 'data:image/jpeg;base64,AAA=';
      }
    });
    const scene = [
      {
        id: 'plot-1',
        type: 'physicsDataPlot',
        x: 100,
        y: 100,
        width: 400,
        height: 300,
        dataPoints: [
          { x: 50000, y: -80000 },
          { x: 999999, y: 888888 }
        ]
      }
    ];
    const artifact = await pipeline.export(scene, { mode: 'single' });
    expect(artifact.pageCount).toBe(1);
    expect(receivedBounds).not.toBeNull();
    // Stroke padding adds a few pixels, but data values (50000, 999999) must not be included
    expect(receivedBounds!.x1).toBeGreaterThanOrEqual(90);
    expect(receivedBounds!.x2).toBeLessThanOrEqual(510);
    expect(receivedBounds!.y1).toBeGreaterThanOrEqual(90);
    expect(receivedBounds!.y2).toBeLessThanOrEqual(410);
  });

  it('exports distant objects as bounded sparse occupied tiles without combinatorial explosion', async () => {
    const renderedTiles: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const pipeline = createArtifactPipeline({
      codecs: fakeCodecs(),
      renderTile: ({ tile }) => {
        renderedTiles.push(tile);
        return 'data:image/jpeg;base64,AAA=';
      }
    });
    const distantScene = [
      { id: 'origin-rect', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
      { id: 'far-rect', type: 'rectangle', x: 50000, y: 50000, width: 50, height: 50 }
    ];
    const artifact = await pipeline.export(distantScene, { mode: 'paged' });
    // Instead of generating millions of dense grid tiles, only the 2 occupied tiles are generated
    expect(artifact.pageCount).toBe(2);
    expect(renderedTiles).toHaveLength(2);
  });

  it('aborts export execution immediately when AbortSignal triggers', async () => {
    const abort = new AbortController();
    let renderCount = 0;
    const pipeline = createArtifactPipeline({
      codecs: fakeCodecs(),
      renderTile: () => {
        renderCount += 1;
        abort.abort();
        return 'data:image/jpeg;base64,AAA=';
      }
    });
    const multiElementScene = [
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
      { id: 'r2', type: 'rectangle', x: 5000, y: 5000, width: 50, height: 50 }
    ];
    await expect(
      pipeline.export(multiElementScene, { mode: 'paged', signal: abort.signal })
    ).rejects.toMatchObject({
      key: 'artifact.cancelled'
    });
    expect(renderCount).toBe(1);
  });

  it('rejects paged export if occupied sparse tile count exceeds maxPdfPages limit', async () => {
    const pipeline = createArtifactPipeline({
      codecs: fakeCodecs(),
      governor: createResourceGovernor({
        limits: createResourceLimits({ maxPdfPages: 2 })
      }),
      renderTile: () => 'data:image/jpeg;base64,AAA='
    });
    const threeDistantTiles = [
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 50, height: 50 },
      { id: 'r2', type: 'rectangle', x: 5000, y: 5000, width: 50, height: 50 },
      { id: 'r3', type: 'rectangle', x: 10000, y: 10000, width: 50, height: 50 }
    ];
    await expect(
      pipeline.export(threeDistantTiles, { mode: 'paged' })
    ).rejects.toMatchObject({
      key: 'resource.pdfTooManyPages'
    });
  });
  it('bounds a huge PDF page before allocating its raster', async () => {
    const pages = [{ width: 1_000_000, height: 1_000_000 }];
    const codecs = fakeCodecs(pages);
    let allocatedPixels = 0;
    codecs.renderPdfPage = async (_bytes, _index, scale) => {
      const edge = Math.max(1, Math.floor(pages[0].width * scale));
      allocatedPixels = edge * edge;
      return raster('small', edge, edge);
    };
    const pipeline = createArtifactPipeline({ codecs });
    const plan = await pipeline.planImport({ bytes: new TextEncoder().encode('%PDF-1.4') });
    for await (const _ of pipeline.import(plan, {
      origin: { x: 0, y: 0 }, newObjectId: () => 'page',
      isEditable: () => true, addImage: () => ({ ok: true })
    })) { /* consume */ }
    expect(allocatedPixels).toBeLessThanOrEqual(16_000_000);
  });

  it('keeps the complete PDF within the aggregate raster budget', async () => {
    const pages = Array.from({ length: 4 }, () => ({ width: 10_000, height: 10_000 }));
    const codecs = fakeCodecs(pages);
    let totalPixels = 0;
    codecs.renderPdfPage = async (_bytes, _index, scale) => {
      const edge = Math.floor(10_000 * scale);
      totalPixels += edge * edge;
      return raster('page', edge, edge);
    };
    const pipeline = createArtifactPipeline({ codecs, governor: createResourceGovernor({
      limits: createResourceLimits({ maxPdfTotalPixels: 4_000_000 })
    }) });
    const plan = await pipeline.planImport({ bytes: new TextEncoder().encode('%PDF-1.4') });
    for await (const _ of pipeline.import(plan, {
      origin: { x: 0, y: 0 }, newObjectId: () => 'page',
      isEditable: () => true, addImage: () => ({ ok: true })
    })) { /* consume */ }
    expect(totalPixels).toBeLessThanOrEqual(4_000_000);
  });

  it('rejects an export tile above its configured pixel budget before rendering', async () => {
    const renderTile = vi.fn(() => 'data:image/jpeg;base64,AAA=');
    const pipeline = createArtifactPipeline({
      codecs: fakeCodecs(), renderTile,
      governor: createResourceGovernor({ limits: createResourceLimits({ maxExportTilePixels: 100_000 }) })
    });
    await expect(pipeline.export([
      { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }
    ], { mode: 'single' })).rejects.toMatchObject({ key: 'resource.exportTooLarge' });
    expect(renderTile).not.toHaveBeenCalled();
  });

  it('does not deliver bytes when cancellation arrives during PDF serialization', async () => {
    const abort = new AbortController();
    const codecs = fakeCodecs();
    codecs.writePdf = async () => {
      abort.abort();
      return new Uint8Array([1]);
    };
    const pipeline = createArtifactPipeline({ codecs, renderTile: () => 'data:image/jpeg;base64,AAA=' });
    await expect(pipeline.export([
      { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }
    ], { mode: 'single', signal: abort.signal })).rejects.toMatchObject({ key: 'artifact.cancelled' });
  });

  it('passes planning cancellation into the PDF decoder', async () => {
    const abort = new AbortController();
    const codecs = fakeCodecs();
    codecs.inspectPdf = vi.fn(async (_bytes, signal) => {
      expect(signal).toBe(abort.signal);
      throw new ArtifactCodecError('artifact.cancelled', 'cancelled');
    });
    const pipeline = createArtifactPipeline({ codecs });
    await expect(pipeline.planImport({ bytes: new TextEncoder().encode('%PDF-1.4') }, abort.signal))
      .rejects.toMatchObject({ key: 'artifact.cancelled' });
  });

});
