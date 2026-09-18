import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import * as Y from 'yjs';

// Intercept the painter so the test can assert what MovableObject feeds it.
// The line painter requires canonical start/end; a regression would feed the
// points form (with start/end cleared) and paint nothing.
const drawElementMock = vi.fn();
vi.mock('@/utils/canvasDrawing', () => ({
  drawElement: (...args) => drawElementMock(...args),
}));

import MovableObject from '@/components/MovableObject.vue';

const buildLineObject = () => {
  const doc = new Y.Doc();
  const drawings = doc.getArray('drawings');
  const object = new Y.Map();
  drawings.push([object]);
  doc.transact(() => {
    object.set('id', 'line-1');
    object.set('type', 'line');
    object.set('x', 100);
    object.set('y', 200);
    object.set('width', 300);
    object.set('height', 150);
    object.set('rotation', 0);
    object.set('color', '#000000');
    object.set('lineWidth', 2);
    object.set('start', { x: 100, y: 200 });
    object.set('end', { x: 400, y: 350 });
    object.set('lineStyle', 'dotted');
    object.set('roughness', 1);
    object.set('arrowStyle', 'end');
  });
  return object;
};

describe('MovableObject line rendering regression (VVE-106)', () => {
  beforeEach(() => {
    drawElementMock.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb();
      return 0;
    });
  });

  it('feeds the painter relative start/end (never the points form) for canonical lines', async () => {
    const object = buildLineObject();
    const wrapper = mount(MovableObject, {
      props: {
        object,
        isSelected: false,
        zoomLevel: 1,
        panOffset: { x: 0, y: 0 },
      },
    });
    await flushPromises();

    expect(drawElementMock).toHaveBeenCalled();
    const calls = drawElementMock.mock.calls;
    const lineCall = calls.find((call) => call[1] && call[1].type === 'line');
    expect(lineCall).toBeTruthy();
    const painted = lineCall[1];

    // The painter bails out (paints nothing) unless start and end are set.
    expect(painted.start).toEqual({ x: 0, y: 0 });
    expect(painted.end).toEqual({ x: 300, y: 150 });
    // Style fields survive so dotted/arrow rendering matches the document.
    expect(painted.lineStyle).toBe('dotted');
    expect(painted.arrowStyle).toBe('end');
    expect(painted.roughness).toBe(1);

    wrapper.unmount();
  });
});
