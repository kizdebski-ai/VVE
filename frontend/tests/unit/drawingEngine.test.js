import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ref } from 'vue';
import { distanceToSegment, isPointInElement } from '../../src/utils/canvasDrawing.js';
import { normalizeBoardObject, validateBoardObject } from '@pilot/boardScene';
import { createWhiteboardSession } from '@/board/whiteboardSession';
import { useDrawingEngine } from '@/composables/useDrawingEngine';

describe('1.1: Grid snap uses correct function name', () => {
  it('useDrawingEngine source does not reference _getSnapSettingsInternal', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/composables/useDrawingEngine.js'),
      'utf-8'
    );
    expect(source).not.toContain('_getSnapSettingsInternal');
    expect(source).toContain('getSnapSettings()');
  });
});

describe('1.2: Rough.js instance caching', () => {
  it('canvasDrawing source uses roughCanvasCache WeakMap', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/utils/canvasDrawing.js'),
      'utf-8'
    );
    expect(source).toContain('roughCanvasCache');
    expect(source).toContain('WeakMap');
  });
});

describe('1.8: Coordinate validation', () => {
  it('the shared document Interface rejects non-finite drawing geometry', () => {
    const object = normalizeBoardObject({
      id: 'stroke-invalid',
      type: 'pen',
      points: [{ x: Number.NaN, y: 10 }],
      color: '#000000',
      lineWidth: 2
    });
    expect(validateBoardObject(object)).toMatchObject({
      ok: false,
      reason: 'invalidGeometry'
    });
  });
});

describe('1.10: Image loading timeout', () => {
  it('ArtifactPipeline decode path times out and releases the object URL', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/board/artifactCodecs.ts'),
      'utf-8'
    );
    expect(source).toContain('setTimeout');
    expect(source).toContain('12_000');
    expect(source).toContain('revokeObjectURL');
  });
});

describe('Geometry: distanceToSegment', () => {
  it('returns 0 for point on segment', () => {
    const dist = distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dist).toBeCloseTo(0, 5);
  });

  it('returns correct perpendicular distance', () => {
    const dist = distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dist).toBeCloseTo(3, 5);
  });

  it('returns distance to nearest endpoint for point beyond segment', () => {
    const dist = distanceToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dist).toBeCloseTo(5, 5);
  });

  it('handles zero-length segment (point)', () => {
    const dist = distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(dist).toBeCloseTo(5, 5);
  });
});

describe('Geometry: isPointInElement', () => {
  it('detects point inside rectangle', () => {
    const element = {
      type: 'rectangle',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 }
    };
    expect(isPointInElement({ x: 50, y: 50 }, element)).toBe(true);
  });

  it('rejects point outside rectangle', () => {
    const element = {
      type: 'rectangle',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 }
    };
    expect(isPointInElement({ x: 200, y: 200 }, element)).toBe(false);
  });

  it('detects point near pen stroke segment', () => {
    const element = {
      type: 'pen',
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    };
    expect(isPointInElement({ x: 50, y: 5 }, element, 10)).toBe(true);
  });

  it('returns false for null/undefined element', () => {
    expect(isPointInElement({ x: 0, y: 0 }, null)).toBe(false);
    expect(isPointInElement({ x: 0, y: 0 }, undefined)).toBe(false);
  });
});

describe('Eraser command wiring', () => {
  const makeEngine = (mode) => {
    const ydoc = new Y.Doc();
    const session = createWhiteboardSession({ ydoc, role: 'teacher' });
    const yDrawings = ref(ydoc.getArray('drawings'));
    const engine = useDrawingEngine({
      isDrawing: ref(true),
      currentTool: ref('eraser'),
      currentColor: ref('#111827'),
      currentLineWidth: ref(3),
      zoomLevel: ref(1),
      panOffset: ref({ x: 0, y: 0 }),
      ydoc,
      yDrawings,
      yjsConnection: ref(null),
      session: ref(session),
      smoothingFactor: ref(0.5),
      getEraserMode: () => mode.value,
      getEraserRadius: () => 10,
      refreshMovableElements: vi.fn(),
      updateGlobalState: vi.fn()
    });
    return { session, engine };
  };

  it('uses the bounded hit object for partial erase and whole-object delete', () => {
    const mode = ref('erase');
    const { session, engine } = makeEngine(mode);
    const stroke = {
      id: 'wired-pen',
      type: 'pen',
      color: '#7c3aed',
      lineWidth: 3,
      points: [{ x: 0, y: 0, p: 0.2 }, { x: 50, y: 0, p: 0.8 }, { x: 100, y: 0, p: 0.4 }]
    };
    expect(session.execute({ kind: 'add', object: stroke })).toEqual({ ok: true });
    const hit = session.snapshot()[0];
    engine.eraseElement(hit.id, { x: 50, y: 0 }, hit);
    expect(session.snapshot()).toHaveLength(2);

    mode.value = 'delete';
    const remaining = session.snapshot()[0];
    engine.eraseElement(remaining.id, { x: remaining.points[0].x, y: remaining.points[0].y }, remaining);
    expect(session.snapshot()).toHaveLength(1);
    expect(session.snapshot()[0].id).not.toBe('wired-pen');
    session.dispose();
  });
});
