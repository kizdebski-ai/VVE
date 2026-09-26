import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalSceneForExport } from '../../src/composables/usePdfExport.js';
import { drawElement } from '../../src/utils/canvasDrawing.js';

describe('canonical PDF export scene', () => {
  it('exports the WhiteboardSession snapshot without consulting raw aliases', () => {
    const canonical = [{
      id: 'image-1',
      type: 'image',
      src: 'data:image/png;base64,AA==',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      rotation: 0
    }];
    const raw = new Y.Array();

    expect(canonicalSceneForExport({
      session: { value: { snapshot: () => canonical } },
      yDrawings: { value: raw }
    })).toEqual(canonical);
  });

  it('normalizes a legacy document only at the pre-session intake edge', () => {
    const doc = new Y.Doc();
    const drawings = doc.getArray('drawings');
    const image = new Y.Map();
    image.set('id', 'image-legacy');
    image.set('type', 'image');
    image.set('dataUrl', 'data:image/png;base64,AA==');
    image.set('position', { x: 5, y: 6 });
    image.set('width', 7);
    image.set('height', 8);
    drawings.push([image]);

    const [exported] = canonicalSceneForExport({
      session: { value: null },
      yDrawings: { value: drawings }
    });

    expect(exported).toMatchObject({
      id: 'image-legacy',
      type: 'image',
      src: 'data:image/png;base64,AA==',
      x: 5,
      y: 6,
      width: 7,
      height: 8,
      rotation: 0
    });
    expect(exported).not.toHaveProperty('dataUrl');
    expect(exported).not.toHaveProperty('position');
  });

  it('renders every canonical VVE-106 object through the PDF renderer seam', () => {
    const calls = [];
    const context = new Proxy(
      { canvas: {} },
      {
        get(target, property) {
          if (!(property in target)) {
            target[property] = (...args) => {
              calls.push([property, ...args]);
              return context;
            };
          }
          return target[property];
        },
        set(target, property, value) {
          target[property] = value;
          return true;
        }
      }
    );
    const roughCanvas = {
      line: (...args) => calls.push(['roughLine', ...args]),
      curve: (...args) => calls.push(['roughCurve', ...args]),
      circle: (...args) => calls.push(['roughCircle', ...args])
    };
    const objects = [
      {
        id: 'coord-2d',
        type: 'coordinateSystem2D',
        x: 10,
        y: 20,
        width: 400,
        height: 300,
        xLabel: 'x',
        yLabel: 'y',
        color: '#111827',
        lineWidth: 2,
        roughness: 0
      },
      {
        id: 'coord-3d',
        type: 'coordinateSystem3D',
        x: 20,
        y: 30,
        width: 320,
        height: 320,
        xLabel: 'x',
        yLabel: 'y',
        zLabel: 'z',
        color: '#111827',
        lineWidth: 2,
        roughness: 0
      },
      {
        id: 'math',
        type: 'mathFunctionPlot',
        x: 30,
        y: 40,
        width: 400,
        height: 300,
        expression: 'sin(x)',
        xRange: [-5, 5],
        color: '#2563eb',
        lineWidth: 3,
        roughness: 0
      },
      {
        id: 'physics',
        type: 'physicsDataPlot',
        x: 40,
        y: 50,
        width: 400,
        height: 300,
        points: [{ x: 0, y: 0 }, { x: 1, y: 9.8 }, { x: 2, y: 19.6 }],
        xLabel: 't',
        yLabel: 'v',
        color: '#f59e0b',
        lineWidth: 2,
        roughness: 0
      }
    ];

    for (const object of objects) {
      expect(() => drawElement(context, object, false, 0, undefined, undefined, {}, roughCanvas))
        .not.toThrow();
    }
    expect(calls.filter(([name]) => name === 'lineTo').length).toBeGreaterThan(100);
    expect(calls.some(([name, text]) => name === 'fillText' && text === 'f(x)')).toBe(true);
    expect(calls.some(([name, text]) => name === 'fillText' && text === 'v')).toBe(true);
  });
});
