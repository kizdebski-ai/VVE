import { describe, expect, it } from 'vitest';
import { drawStyledPen } from '../../src/utils/penStyles';

// Recording canvas mock: captures every stroke with its resolved lineWidth and
// strokeStyle so rendering behavior (not source text) can be asserted.
const recordingCtx = () => {
  const strokes = [];
  let lineWidth = 1;
  let strokeStyle = '';
  const ctx = {
    save() {},
    restore() {},
    get lineWidth() { return lineWidth; },
    set lineWidth(value) { lineWidth = value; },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(value) { strokeStyle = value; },
    lineCap: 'butt',
    lineJoin: 'miter',
    beginPath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    stroke() { strokes.push({ lineWidth, strokeStyle }); },
    fill() {},
    arc() {},
  };
  return { ctx, strokes };
};

const straightStroke = (pressures) => pressures.map((pressure, index) => ({
  x: 10 + index * 30,
  y: 10,
  t: index * 16,
  ...(pressure === null ? {} : { p: pressure })
}));

describe('drawStyledPen pressure rendering', () => {
  it('modulates ink width from point pressure values', () => {
    const { ctx, strokes } = recordingCtx();
    // Constant speed/geometry: only pressure differs between segments.
    drawStyledPen(ctx, straightStroke([0.5, 0.1, 0.9]), {
      style: 'gel',
      color: '#111827',
      lineWidth: 3
    });

    const inkStrokes = strokes.filter((stroke) => stroke.strokeStyle === '#111827');
    expect(inkStrokes.length).toBeGreaterThanOrEqual(2);
    const widths = inkStrokes.map((stroke) => stroke.lineWidth);
    const lightWidth = widths[0]; // segment towards p=0.1
    const heavyWidth = widths[1]; // segment towards p=0.9
    expect(heavyWidth).toBeGreaterThan(lightWidth * 1.8);
  });

  it('keeps a constant width when no pressure values are present', () => {
    const { ctx, strokes } = recordingCtx();
    drawStyledPen(ctx, straightStroke([null, null, null]), {
      style: 'gel',
      color: '#111827',
      lineWidth: 3
    });

    const inkStrokes = strokes.filter((stroke) => stroke.strokeStyle === '#111827');
    expect(inkStrokes.length).toBeGreaterThanOrEqual(2);
    const widths = inkStrokes.map((stroke) => stroke.lineWidth);
    expect(new Set(widths).size).toBe(1);
  });

  it('does not apply preset or global smoothing on top of pressure detail', () => {
    const points = straightStroke([0.5, 0.2, 0.8, 0.4]);
    const ops = [];
    const lineWidthRef = { value: 1 };
    const strokeStyleRef = { value: '' };
    const tracingCtx = {
      save() {},
      restore() {},
      get lineWidth() { return lineWidthRef.value; },
      set lineWidth(value) { lineWidthRef.value = value; },
      get strokeStyle() { return strokeStyleRef.value; },
      set strokeStyle(value) { strokeStyleRef.value = value; },
      lineCap: 'butt',
      lineJoin: 'miter',
      beginPath() {},
      moveTo(x, y) { ops.push(['move', x, y, strokeStyleRef.value]); },
      lineTo(x, y) { ops.push(['line', x, y, strokeStyleRef.value]); },
      bezierCurveTo() { ops.push(['bezier', strokeStyleRef.value]); },
      stroke() {},
      fill() {},
      arc() {},
    };
    drawStyledPen(tracingCtx, points, {
      style: 'gel',
      color: '#111827',
      lineWidth: 3,
      globalSmoothing: 0.9,
      config: { smoothing: 0.9 }
    });

    // Smoothing disabled under pressure: no curved interpolation and the ink
    // segments connect the raw pressure points directly (shadow strokes carry
    // a small offset, so only the exact-color ink ops are compared).
    expect(ops.some(([op, style]) => op === 'bezier' && style === '#111827')).toBe(false);
    const inkOps = ops.filter(([, , , style]) => style === '#111827');
    expect(inkOps.length).toBeGreaterThanOrEqual((points.length - 1) * 2);
    for (const [, x, y] of inkOps) {
      expect(
        points.some((point) => Math.abs(point.x - x) < 1e-9 && Math.abs(point.y - y) < 1e-9)
      ).toBe(true);
    }
  });
});
