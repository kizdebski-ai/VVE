import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createArtifactPipeline, deliverPdfArtifact } from '@/board/artifactPipeline';
import { ArtifactCodecError } from '@/board/artifactCodecs';
import { detectArtifactFormat, polishArtifactMessage } from '@pilot/artifactContract';
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
    expect(events.at(-1).message).toMatch(/2 stron/);
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
});
