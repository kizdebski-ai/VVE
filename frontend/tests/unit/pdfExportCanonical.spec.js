import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalSceneForExport } from '../../src/composables/usePdfExport.js';

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
});
