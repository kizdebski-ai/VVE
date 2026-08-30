/**
 * ArtifactPipeline (VVE-107, Module 7).
 *
 * Owns lesson artifacts from MIME validation through canonical image commands
 * or exported PDF bytes. ResourceGovernor admits work before decode and
 * insertion. Progress is yielded in source order; cancellation reports exactly
 * which pages were committed. Temporary canvases are released by the codec.
 */
import {
  detectArtifactFormat,
  polishArtifactMessage,
  type ArtifactMessageKey,
  type ArtifactPipeline,
  type ArtifactProgress,
  type ExportArtifact,
  type ExportOptions,
  type ImportPlan,
  type ImportSource,
  type ImportTarget
} from '@pilot/artifactContract';
import {
  createResourceGovernor,
  type AdmissionDecision,
  type ResourceGovernor
} from '@pilot/resourceGovernor';
import {
  ArtifactCodecError,
  createBrowserArtifactCodecs,
  yieldToEventLoop,
  type ArtifactCodecs,
  type RasterPage
} from './artifactCodecs';

const PAGE_GAP = 40;
const DEFAULT_PDF_SCALE = 1.5;
const MAX_DISPLAY_EDGE = 1_600;
const EXPORT_DPI = 150;
const PAGE_SIZE_INCH = { w: 8.27, h: 11.69 };
const PAGE_PX = {
  w: Math.round(PAGE_SIZE_INCH.w * EXPORT_DPI),
  h: Math.round(PAGE_SIZE_INCH.h * EXPORT_DPI)
};
const PAGED_TILE = { w: 2000, h: 1400 };

export type SceneBounds = { x1: number; y1: number; x2: number; y2: number };

export interface CreateArtifactPipelineOptions {
  governor?: ResourceGovernor;
  codecs?: ArtifactCodecs;
  clientKey?: string;
  drawScene?: (
    ctx: CanvasRenderingContext2D,
    elements: readonly Record<string, unknown>[]
  ) => void;
  renderTile?: (input: {
    tile: SceneBounds;
    elements: readonly Record<string, unknown>[];
  }) => string;
}

const withMessage = (
  partial: Omit<ArtifactProgress, 'message'> & { extras?: { committed?: number; total?: number } }
): ArtifactProgress => ({
  phase: partial.phase,
  current: partial.current,
  total: partial.total,
  committed: partial.committed,
  messageKey: partial.messageKey,
  objectIds: partial.objectIds,
  message: polishArtifactMessage(partial.messageKey, partial.extras)
});

const failed = (
  key: ArtifactMessageKey,
  current: number,
  total: number,
  committed: number,
  objectIds: string[] = []
): ArtifactProgress =>
  withMessage({
    phase: 'failed',
    current,
    total,
    committed,
    messageKey: key,
    objectIds,
    extras: { committed, total }
  });

const decisionKey = (decision: AdmissionDecision): ArtifactMessageKey =>
  'messageKey' in decision ? decision.messageKey : 'resource.unknownUsage';

const scaleForPixels = (width: number, height: number, maxPixels: number, preferred = DEFAULT_PDF_SCALE): number => {
  const area = Math.max(1, width * height);
  const atPreferred = area * preferred * preferred;
  if (atPreferred <= maxPixels) return preferred;
  return Math.max(0.25, Math.sqrt(maxPixels / area));
};

const fitDisplay = (width: number, height: number): { width: number; height: number } => {
  const longest = Math.max(width, height, 1);
  if (longest <= MAX_DISPLAY_EDGE) return { width, height };
  const ratio = MAX_DISPLAY_EDGE / longest;
  return { width: width * ratio, height: height * ratio };
};

const point = (value: unknown): { x: number; y: number } | null => {
  if (!value) return null;
  if (Array.isArray(value)) {
    const [x, y] = value as number[];
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  const record = value as { x?: number; y?: number };
  if (Number.isFinite(record.x) && Number.isFinite(record.y)) {
    return { x: record.x as number, y: record.y as number };
  }
  return null;
};

export const boundsForObject = (element: Record<string, unknown>): SceneBounds | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  if (Array.isArray(element.points)) {
    for (const item of element.points as unknown[]) {
      const p = point(item);
      if (p) add(p.x, p.y);
    }
  }
  const start = point(element.start);
  const end = point(element.end);
  if (start) add(start.x, start.y);
  if (end) add(end.x, end.y);
  if (Number.isFinite(element.x) && Number.isFinite(element.y)) {
    add(element.x as number, element.y as number);
    add((element.x as number) + (Number(element.width) || 0), (element.y as number) + (Number(element.height) || 0));
  }
  if (minX === Infinity) return null;
  const padding = Math.max(2, Number(element.lineWidth) || 0);
  return { x1: minX - padding, y1: minY - padding, x2: maxX + padding, y2: maxY + padding };
};

export const boundsForScene = (elements: readonly Record<string, unknown>[]): SceneBounds | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const box = boundsForObject(element);
    if (!box) continue;
    minX = Math.min(minX, box.x1);
    minY = Math.min(minY, box.y1);
    maxX = Math.max(maxX, box.x2);
    maxY = Math.max(maxY, box.y2);
  }
  if (minX === Infinity) return null;
  return { x1: minX, y1: minY, x2: maxX, y2: maxY };
};

const tilesFor = (bounds: SceneBounds, mode: 'single' | 'paged'): SceneBounds[] => {
  if (mode === 'single') return [bounds];
  const tiles: SceneBounds[] = [];
  const tilesX = Math.max(1, Math.ceil((bounds.x2 - bounds.x1) / PAGED_TILE.w));
  const tilesY = Math.max(1, Math.ceil((bounds.y2 - bounds.y1) / PAGED_TILE.h));
  for (let ty = 0; ty < tilesY; ty += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      tiles.push({
        x1: bounds.x1 + tx * PAGED_TILE.w,
        y1: bounds.y1 + ty * PAGED_TILE.h,
        x2: bounds.x1 + (tx + 1) * PAGED_TILE.w,
        y2: bounds.y1 + (ty + 1) * PAGED_TILE.h
      });
    }
  }
  return tiles;
};

const intersects = (a: SceneBounds, b: SceneBounds): boolean =>
  !(b.x2 <= a.x1 || b.x1 >= a.x2 || b.y2 <= a.y1 || b.y1 >= a.y2);

const renderTileDataUrl = (
  tile: SceneBounds,
  elements: readonly Record<string, unknown>[],
  drawScene: CreateArtifactPipelineOptions['drawScene']
): string => {
  const marginPx = Math.round(0.2 * EXPORT_DPI);
  const worldW = Math.max(1, tile.x2 - tile.x1);
  const worldH = Math.max(1, tile.y2 - tile.y1);
  const scale = Math.min((PAGE_PX.w - 2 * marginPx) / worldW, (PAGE_PX.h - 2 * marginPx) / worldH);
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_PX.w;
  canvas.height = PAGE_PX.h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    canvas.width = 0;
    canvas.height = 0;
    throw new ArtifactCodecError('artifact.exportFailed', 'Canvas unavailable.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_PX.w, PAGE_PX.h);
  ctx.save();
  ctx.translate(marginPx - tile.x1 * scale, marginPx - tile.y1 * scale);
  ctx.scale(scale, scale);
  drawScene?.(ctx, elements);
  ctx.restore();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
};

export const createArtifactPipeline = (
  options: CreateArtifactPipelineOptions = {}
): ArtifactPipeline => {
  const governor = options.governor ?? createResourceGovernor();
  const codecs = options.codecs ?? createBrowserArtifactCodecs();
  const clientKey = options.clientKey ?? 'local';
  const limits = governor.limits();

  const planImport = async (source: ImportSource): Promise<ImportPlan> => {
    const detected = detectArtifactFormat(source.bytes, source.declaredMime);
    if (!detected.ok) {
      throw new ArtifactCodecError(detected.key, polishArtifactMessage(detected.key));
    }
    const fileName = source.fileName || (detected.mime === 'application/pdf' ? 'material.pdf' : 'obraz');
    if (detected.mime === 'application/pdf') {
      if (source.bytes.byteLength > limits.maxPdfBytes) {
        throw new ArtifactCodecError('resource.pdfTooLarge', polishArtifactMessage('resource.pdfTooLarge'));
      }
      let pages: { width: number; height: number }[];
      try {
        pages = (await codecs.inspectPdf(source.bytes)).pages;
      } catch (error) {
        if (error instanceof ArtifactCodecError) throw error;
        throw new ArtifactCodecError('artifact.malformed', polishArtifactMessage('artifact.malformed'));
      }
      if (pages.length > limits.maxPdfPages) {
        throw new ArtifactCodecError('resource.pdfTooManyPages', polishArtifactMessage('resource.pdfTooManyPages'));
      }
      if (!pages.length) {
        throw new ArtifactCodecError('artifact.malformed', polishArtifactMessage('artifact.malformed'));
      }
      return {
        kind: 'pdf',
        mime: detected.mime,
        fileName,
        byteLength: source.bytes.byteLength,
        pageCount: pages.length,
        pages: pages.map((page, index) => ({ index, width: page.width, height: page.height })),
        bestEffort: false,
        bytes: source.bytes
      };
    }
    if (source.bytes.byteLength > limits.maxEncodedImageBytes) {
      throw new ArtifactCodecError('resource.imageTooLarge', polishArtifactMessage('resource.imageTooLarge'));
    }
    return {
      kind: 'image',
      mime: detected.mime,
      fileName,
      byteLength: source.bytes.byteLength,
      pageCount: 1,
      pages: [{ index: 0, width: 0, height: 0 }],
      bestEffort: detected.bestEffort,
      bytes: source.bytes
    };
  };

  async function* runImport(
    plan: ImportPlan,
    target: ImportTarget,
    signal?: AbortSignal
  ): AsyncGenerator<ArtifactProgress> {
    const total = plan.pageCount;
    const objectIds: string[] = [];
    let committed = 0;
    const job = governor.admit(
      {
        kind: plan.kind === 'pdf' ? 'pdf' : 'artifactWork',
        bytes: plan.byteLength,
        pageCount: plan.pageCount,
        clientKey
      },
      { now: Date.now() }
    );
    if (job.decision !== 'allow' && job.decision !== 'allowWithBudget') {
      yield failed(decisionKey(job), 0, total, 0);
      return;
    }
    let jobOpen = true;
    const finishJob = () => {
      if (!jobOpen) return;
      jobOpen = false;
      governor.observe({ kind: 'artifactFinished', clientKey });
    };

    try {
      if (!target.isEditable()) {
        yield failed('artifact.readOnlyMutation', 0, total, 0);
        return;
      }
      yield withMessage({
        phase: 'planning',
        current: 0,
        total,
        committed,
        messageKey: 'artifact.working',
        objectIds,
        extras: { committed: 0, total }
      });

      let cursorY = target.origin.y;
      for (let index = 0; index < total; index += 1) {
        if (signal?.aborted) {
          yield withMessage({
            phase: 'cancelled',
            current: index,
            total,
            committed,
            messageKey: 'artifact.cancelled',
            objectIds: [...objectIds],
            extras: { committed, total }
          });
          return;
        }
        yield withMessage({
          phase: 'decoding',
          current: index + 1,
          total,
          committed,
          messageKey: 'artifact.working',
          objectIds: [...objectIds],
          extras: { committed: index + 1, total }
        });

        let raster: RasterPage;
        try {
          if (plan.kind === 'pdf') {
            const page = plan.pages[index];
            const scale = scaleForPixels(
              page?.width || 1,
              page?.height || 1,
              limits.maxDecodedPixelsPerImage
            );
            raster = await codecs.renderPdfPage(plan.bytes, index, scale, signal);
          } else {
            raster = await codecs.decodeImage(plan.bytes, plan.mime, signal);
          }
        } catch (error) {
          const key =
            error instanceof ArtifactCodecError
              ? error.key
              : plan.bestEffort
                ? 'artifact.decodeFailed'
                : 'artifact.malformed';
          if (key === 'artifact.cancelled') {
            yield withMessage({
              phase: 'cancelled',
              current: index,
              total,
              committed,
              messageKey: 'artifact.cancelled',
              objectIds: [...objectIds],
              extras: { committed, total }
            });
            return;
          }
          yield failed(key, index + 1, total, committed, [...objectIds]);
          return;
        }

        const imageAdmit = governor.admit(
          {
            kind: 'decodedImage',
            bytes: raster.encodedBytes,
            decodedPixels: raster.pixels,
            clientKey
          },
          { now: Date.now() }
        );
        if (imageAdmit.decision !== 'allow' && imageAdmit.decision !== 'allowWithBudget') {
          raster.release();
          yield failed(decisionKey(imageAdmit), index + 1, total, committed, [...objectIds]);
          return;
        }
        if (raster.dataUrl.length > limits.maxImageDataUrlChars) {
          raster.release();
          yield failed('resource.imageTooLarge', index + 1, total, committed, [...objectIds]);
          return;
        }

        const display = fitDisplay(raster.displayWidth || raster.width, raster.displayHeight || raster.height);
        if (!target.isEditable()) {
          raster.release();
          yield failed('artifact.readOnlyMutation', index + 1, total, committed, [...objectIds]);
          return;
        }
        const id = target.newObjectId();
        const added = target.addImage({
          id,
          type: 'image',
          src: raster.dataUrl,
          x: target.origin.x,
          y: plan.kind === 'pdf' ? cursorY : target.origin.y - display.height / 2,
          width: display.width,
          height: display.height,
          rotation: 0,
          timestamp: Date.now()
        });
        raster.release();
        if (!added.ok) {
          yield failed('artifact.importFailed', index + 1, total, committed, [...objectIds]);
          return;
        }
        objectIds.push(id);
        committed += 1;
        if (plan.kind === 'pdf') cursorY += display.height + PAGE_GAP;
        yield withMessage({
          phase: 'committing',
          current: index + 1,
          total,
          committed,
          messageKey: 'artifact.working',
          objectIds: [...objectIds],
          extras: { committed, total }
        });
        await yieldToEventLoop();
      }

      yield withMessage({
        phase: 'done',
        current: total,
        total,
        committed,
        messageKey: 'artifact.importComplete',
        objectIds: [...objectIds],
        extras: { committed, total }
      });
    } finally {
      finishJob();
    }
  }

  return {
    planImport,
    import: (plan, target, signal) => runImport(plan, target, signal),
    export: async (scene, exportOptions: ExportOptions): Promise<ExportArtifact> => {
      if (!scene.length) {
        throw new ArtifactCodecError('artifact.emptyExport', polishArtifactMessage('artifact.emptyExport'));
      }
      const bounds = boundsForScene(scene);
      if (!bounds) {
        throw new ArtifactCodecError('artifact.emptyExport', polishArtifactMessage('artifact.emptyExport'));
      }
      const job = governor.admit(
        {
          kind: 'export',
          decodedPixels: PAGE_PX.w * PAGE_PX.h,
          clientKey
        },
        { now: Date.now() }
      );
      if (job.decision !== 'allow' && job.decision !== 'allowWithBudget') {
        throw new ArtifactCodecError(decisionKey(job), polishArtifactMessage(decisionKey(job)));
      }
      try {
        if (exportOptions.signal?.aborted) {
          throw new ArtifactCodecError('artifact.cancelled', polishArtifactMessage('artifact.cancelled'));
        }
        const tiles = tilesFor(bounds, exportOptions.mode);
        const pages: { dataUrl: string }[] = [];
        for (const tile of tiles) {
          const inTile = scene.filter((element) => {
            const box = boundsForObject(element);
            return box ? intersects(tile, box) : false;
          });
          if (exportOptions.mode === 'paged' && !inTile.length) continue;
          const dataUrl = options.renderTile
            ? options.renderTile({
                tile,
                elements: exportOptions.mode === 'paged' ? inTile : scene
              })
            : renderTileDataUrl(
                tile,
                exportOptions.mode === 'paged' ? inTile : scene,
                options.drawScene
              );
          pages.push({ dataUrl });
          await yieldToEventLoop();
        }
        if (!pages.length) {
          throw new ArtifactCodecError('artifact.emptyExport', polishArtifactMessage('artifact.emptyExport'));
        }
        const bytes = await codecs.writePdf(pages, { labels: exportOptions.mode === 'paged' });
        return {
          bytes,
          mime: 'application/pdf',
          filename: exportOptions.filename ?? (exportOptions.mode === 'paged' ? 'notatki.pdf' : 'tablica.pdf'),
          pageCount: pages.length
        };
      } finally {
        governor.observe({ kind: 'artifactFinished', clientKey });
      }
    }
  };
};

export const deliverPdfArtifact = async (artifact: ExportArtifact): Promise<'share' | 'tab' | 'download'> => {
  const blob = new Blob([artifact.bytes], { type: 'application/pdf' });
  const file = new File([blob], artifact.filename, { type: 'application/pdf' });
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: artifact.filename });
    return 'share';
  }
  const url = URL.createObjectURL(blob);
  try {
    if (isIOS) {
      window.open(url, '_blank');
      return 'tab';
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.filename;
    anchor.click();
    return 'download';
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 8_000);
  }
};
